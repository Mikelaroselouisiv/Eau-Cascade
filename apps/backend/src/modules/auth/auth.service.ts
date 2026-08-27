import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { normalizePhone } from '../../common/utils/phone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly rolesService: RolesService,
  ) {}

  /** True tant qu’aucun utilisateur n’existe (première installation). */
  async getSetupStatus() {
    const count = await this.prisma.user.count();
    return { needsFirstUser: count === 0 };
  }

  /**
   * Premier compte = administrateur (base vide). Ensuite : 403 — les comptes sont créés par un admin (POST /users).
   */
  async register(registerDto: RegisterDto) {
    const existingCount = await this.prisma.user.count();
    if (existingCount > 0) {
      throw new ForbiddenException(
        "L'inscription publique est fermée. Connectez-vous ou demandez à un administrateur de créer votre compte.",
      );
    }

    const user = await this.usersService.create({
      phone: registerDto.phone,
      password: registerDto.password,
      role: 'ADMIN',
      email: registerDto.email?.trim() || undefined,
      fullName: registerDto.fullName?.trim() || undefined,
    });
    const tokens = await this.createSessionTokens(
      user.id,
      this.phoneForJwt(user.phone),
      user.role,
    );
    await this.auditService.log({
      userId: user.id,
      action: 'REGISTER',
      entity: 'USER',
      entityId: String(user.id),
    });
    return { user: await this.toSessionUser(user), ...tokens };
  }

  async login(loginDto: LoginDto) {
    const phoneNorm = normalizePhone(loginDto.phone);
    const user = await this.usersService.findByPhone(phoneNorm);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('Compte désactivé');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.createSessionTokens(
      user.id,
      this.phoneForJwt(user.phone),
      user.role,
    );
    await this.auditService.log({
      userId: user.id,
      action: 'LOGIN',
      entity: 'SESSION',
      entityId: String(user.id),
    });
    return {
      ...tokens,
      user: await this.toSessionUser(user),
    };
  }

  async me(userId: number) {
    const user = await this.usersService.findOne(userId);
    return this.toSessionUser(user);
  }

  async refresh(dto: RefreshTokenDto) {
    const session = await this.prisma.session.findFirst({
      where: {
        refreshToken: dto.refreshToken,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.createSessionTokens(
      session.user.id,
      this.phoneForJwt(session.user.phone),
      session.user.role,
    );
    await this.auditService.log({
      userId: session.user.id,
      action: 'TOKEN_REFRESH',
      entity: 'SESSION',
      entityId: String(session.id),
    });
    return tokens;
  }

  async logout(dto: RefreshTokenDto) {
    await this.prisma.session.updateMany({
      where: { refreshToken: dto.refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** JWT aligné sur le téléphone stocké (Prisma peut typer `phone` nullable tant que le client n’est pas régénéré). */
  private phoneForJwt(phone: string | null | undefined): string {
    const v = phone?.trim();
    if (!v) {
      throw new UnauthorizedException('Compte sans numéro de téléphone');
    }
    return v;
  }

  /** Session utilisateur complète (permissions incluses) — login / register / me. */
  private async toSessionUser(user: {
    id: number;
    phone: string | null;
    email?: string | null;
    role: string;
    fullName?: string | null;
    isActive?: boolean;
    companyId?: number | null;
    departmentId?: number | null;
    departmentIds?: number[];
    createdAt?: Date;
  }) {
    const roleRow = await this.prisma.appRole.findFirst({
      where: { code: user.role, deletedAt: null, isActive: true },
      select: { label: true, permissions: true },
    });
    let permissions = roleRow?.permissions ?? [];
    // Filet de sécurité : un ADMIN système sans ligne AppRole garde l’accès complet.
    if ((!permissions || permissions.length === 0) && user.role === 'ADMIN') {
      permissions = ['*'];
    }
    let departmentIds = user.departmentIds ?? [];
    if (!departmentIds.length) {
      const links = await this.prisma.userDepartment.findMany({
        where: { userId: user.id, deletedAt: null },
        select: { departmentId: true },
        orderBy: { id: 'asc' },
      });
      departmentIds = links.map((l) => l.departmentId);
    }
    if (user.departmentId != null && !departmentIds.includes(user.departmentId)) {
      departmentIds = [user.departmentId, ...departmentIds];
    }
    return {
      id: user.id,
      phone: user.phone,
      email: user.email ?? null,
      role: user.role,
      roleLabel: roleRow?.label ?? user.role,
      permissions,
      fullName: user.fullName ?? null,
      isActive: user.isActive ?? true,
      companyId: user.companyId ?? null,
      departmentId: user.departmentId ?? null,
      departmentIds,
      createdAt: user.createdAt,
    };
  }

  private async createSessionTokens(userId: number, phone: string, role: string) {
    const accessToken = await this.signToken(userId, phone, role);
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, phone, role, type: 'refresh' },
      { expiresIn: '7d' },
    );
    await this.prisma.session.create({
      data: {
        userId,
        refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { accessToken, refreshToken };
  }

  private signToken(userId: number, phone: string, role: string) {
    return this.jwtService.signAsync({ sub: userId, phone, role });
  }
}
