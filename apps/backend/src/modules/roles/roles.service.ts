import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  permissionsSatisfy,
  SYSTEM_ROLE_LABELS,
} from '../../common/permissions';
import { isValidRoleCode, normalizeRoleCode } from '../../common/role-code';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService implements OnModuleInit {
  private cache = new Map<string, { permissions: string[]; isActive: boolean; expires: number }>();
  private readonly cacheTtlMs = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSystemRoles();
  }

  listPermissions() {
    return PERMISSIONS;
  }

  findAll() {
    return this.prisma.appRole.findMany({
      where: { deletedAt: null },
      orderBy: [{ isSystem: 'desc' }, { label: 'asc' }],
    });
  }

  async findByCode(code: string) {
    const cached = this.cache.get(code);
    if (cached && cached.expires > Date.now()) {
      return { code, permissions: cached.permissions, isActive: cached.isActive };
    }
    const row = await this.prisma.appRole.findFirst({
      where: { code, deletedAt: null },
      select: { code: true, permissions: true, isActive: true },
    });
    if (row) {
      this.cache.set(code, {
        permissions: row.permissions,
        isActive: row.isActive,
        expires: Date.now() + this.cacheTtlMs,
      });
    }
    return row;
  }

  async getPermissionsForUserRole(roleCode: string): Promise<string[]> {
    const row = await this.findByCode(roleCode);
    return row?.isActive ? row.permissions : [];
  }

  async userCanAccessRoleGate(userRoleCode: string, requiredRoles: string[]): Promise<boolean> {
    const userRole = await this.prisma.appRole.findFirst({
      where: { code: userRoleCode, deletedAt: null, isActive: true },
    });
    if (!userRole) return false;
    if (userRole.permissions.includes('*')) return true;

    // Ne plus court-circuiter sur le seul code de rôle (ex. MANAGER) :
    // un gérant sans les permissions cibles ne doit pas passer.
    // Compat : accès si les permissions du rôle couvrent celles d’au moins un rôle requis.
    for (const req of requiredRoles) {
      const target = await this.prisma.appRole.findFirst({
        where: { code: req, deletedAt: null, isActive: true },
      });
      if (target && permissionsSatisfy(userRole.permissions, target.permissions)) {
        return true;
      }
    }
    return false;
  }

  async assertRoleExists(code: string) {
    const role = await this.prisma.appRole.findFirst({
      where: { code, deletedAt: null, isActive: true },
    });
    if (!role) {
      throw new BadRequestException(`Rôle « ${code} » introuvable ou inactif.`);
    }
    return role;
  }

  async create(dto: CreateRoleDto) {
    const code = normalizeRoleCode(dto.code);
    if (!isValidRoleCode(code)) {
      throw new BadRequestException(
        'Code de rôle invalide (lettres, chiffres, _ ; commence par une lettre).',
      );
    }
    const permissions = this.sanitizePermissions(dto.permissions);
    if (permissions.length === 0) {
      throw new BadRequestException('Cochez au moins une autorisation.');
    }
    const existing = await this.prisma.appRole.findFirst({ where: { code } });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Le rôle « ${code} » existe déjà.`);
    }
    const data = {
      code,
      label: dto.label.trim(),
      description: dto.description?.trim() || null,
      permissions,
      isActive: true,
      deletedAt: null as Date | null,
    };
    if (existing?.deletedAt) {
      const restored = await this.prisma.appRole.update({
        where: { id: existing.id },
        data: { ...data, isSystem: existing.isSystem },
      });
      this.cache.delete(code);
      return restored;
    }
    try {
      const created = await this.prisma.appRole.create({
        data: { ...data, isSystem: false },
      });
      this.cache.delete(code);
      return created;
    } catch (err) {
      if (this.isUniqueConflict(err)) {
        throw new ConflictException(`Le rôle « ${code} » existe déjà.`);
      }
      throw err;
    }
  }

  async update(id: number, dto: UpdateRoleDto) {
    const existing = await this.prisma.appRole.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Rôle introuvable');
    }
    const permissions =
      dto.permissions === undefined ? undefined : this.sanitizePermissions(dto.permissions);
    const updated = await this.prisma.appRole.update({
      where: { id },
      data: {
        label: dto.label?.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        permissions,
        isActive: dto.isActive,
      },
    });
    this.cache.delete(existing.code);
    return updated;
  }

  async remove(id: number) {
    const existing = await this.prisma.appRole.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Rôle introuvable');
    }
    if (existing.isSystem) {
      throw new BadRequestException('Les rôles système ne peuvent pas être supprimés.');
    }
    const usersCount = await this.prisma.user.count({ where: { role: existing.code } });
    if (usersCount > 0) {
      throw new BadRequestException(
        `Impossible : ${usersCount} utilisateur(s) ont encore ce rôle.`,
      );
    }
    const deleted = await this.prisma.appRole.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    this.cache.delete(existing.code);
    return deleted;
  }

  /**
   * Nettoie la liste. Le catalogue `PERMISSIONS` sert à l’UI ; on n’interdit pas
   * un code encore présent en base (sinon PATCH → 400 et la matrice ne bouge pas).
   */
  private sanitizePermissions(perms: string[]) {
    return Array.from(
      new Set(perms.map((p) => String(p).trim()).filter((p) => p.length > 0)),
    );
  }

  private isUniqueConflict(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err != null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    );
  }

  private async ensureSystemRoles() {
    for (const [code, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const existing = await this.prisma.appRole.findFirst({ where: { code } });
      if (!existing) {
        await this.prisma.appRole.create({
          data: {
            code,
            label: SYSTEM_ROLE_LABELS[code] ?? code,
            permissions: perms,
            isSystem: true,
          },
        });
        continue;
      }
      // Ajustements ciblés sans réécrire toute la matrice (Config → Rôles).
      if (code === 'CHEF_PRODUCTION') {
        const stripped = existing.permissions.filter(
          (p) =>
            p !== 'purchasing.manage' &&
            p !== 'stock.view' &&
            p !== 'stock.manage' &&
            p !== 'stock.adjust' &&
            p !== 'stock.raw_in',
        );
        if (stripped.length !== existing.permissions.length) {
          await this.prisma.appRole.update({
            where: { id: existing.id },
            data: { permissions: stripped },
          });
          this.cache.delete(code);
        }
      }
      if (code === 'CASHIER' && !existing.permissions.includes('stock.raw_in')) {
        await this.prisma.appRole.update({
          where: { id: existing.id },
          data: { permissions: [...existing.permissions, 'stock.raw_in'] },
        });
        this.cache.delete(code);
      }
    }
  }
}
