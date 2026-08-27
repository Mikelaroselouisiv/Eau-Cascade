import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { isManagerRole } from '../../common/user-scope';
import { normalizePhone } from '../../common/utils/phone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RolesService } from '../roles/roles.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SafeUser, UsersRepository } from './users.repository';

export type PublicUser = Omit<SafeUser, 'managedDepartments'> & { departmentIds: number[] };

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rolesService: RolesService,
  ) {}

  private toPublic(user: SafeUser): PublicUser {
    const fromJoin = user.managedDepartments.map((row) => row.departmentId);
    const departmentIds = Array.from(
      new Set([
        ...fromJoin,
        ...(user.departmentId != null ? [user.departmentId] : []),
      ]),
    );
    const { managedDepartments: _links, ...rest } = user;
    return { ...rest, departmentIds };
  }

  async create(createUserDto: CreateUserDto, actorId?: number): Promise<PublicUser> {
    const phoneNorm = normalizePhone(createUserDto.phone);
    const existingUser = await this.usersRepository.findByPhone(phoneNorm);
    if (existingUser) {
      throw new ConflictException('Ce numéro de téléphone est déjà utilisé');
    }

    const role = createUserDto.role ?? 'CASHIER';
    await this.rolesService.assertRoleExists(role);
    if (role !== 'ADMIN' && createUserDto.departmentId == null) {
      throw new BadRequestException(
        'Un département est requis pour ce rôle (sauf pour le profil administrateur global).',
      );
    }

    let companyConnect: { connect: { id: number } } | undefined;
    let departmentConnect: { connect: { id: number } } | undefined;
    if (createUserDto.departmentId != null) {
      const dept = await this.prisma.department.findUnique({
        where: { id: createUserDto.departmentId },
      });
      if (!dept) {
        throw new BadRequestException('Département introuvable');
      }
      companyConnect = { connect: { id: dept.companyId } };
      departmentConnect = { connect: { id: dept.id } };
    }

    const password = await bcrypt.hash(createUserDto.password, 10);
    const user = await this.usersRepository.create({
      phone: phoneNorm,
      password,
      role,
      fullName: createUserDto.fullName,
      isActive: createUserDto.isActive ?? true,
      ...(createUserDto.email?.trim() ? { email: createUserDto.email.trim() } : {}),
      ...(companyConnect ? { company: companyConnect } : {}),
      ...(departmentConnect ? { department: departmentConnect } : {}),
    });

    await this.replaceManagedDepartments(user.id, role, {
      departmentId: createUserDto.departmentId ?? null,
      departmentIds: createUserDto.departmentIds,
    });

    await this.auditService.log({
      userId: actorId,
      action: 'USER_CREATED',
      entity: 'User',
      entityId: String(user.id),
      metadata: { phone: user.phone, role: user.role },
    });
    const created = await this.usersRepository.findById(user.id);
    if (!created) throw new NotFoundException('Utilisateur introuvable');
    return this.toPublic(created);
  }

  async findAll() {
    const rows = await this.usersRepository.findAll();
    return rows.map((u) => this.toPublic(u));
  }

  async findOne(id: number) {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    return this.toPublic(user);
  }

  findByPhone(phone: string) {
    return this.usersRepository.findByPhone(normalizePhone(phone));
  }

  async update(id: number, dto: UpdateUserDto, actorId?: number) {
    const existing = await this.usersRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    if (dto.phone != null) {
      const next = normalizePhone(dto.phone);
      if (next !== existing.phone) {
        const taken = await this.usersRepository.findByPhone(next);
        if (taken) {
          throw new ConflictException('Ce numéro de téléphone est déjà utilisé');
        }
      }
    }

    if (dto.role != null) {
      await this.rolesService.assertRoleExists(dto.role);
    }
    if (dto.role != null && dto.role !== 'ADMIN' && existing.role === 'ADMIN') {
      const otherAdmins = await this.prisma.user.count({
        where: { role: 'ADMIN', id: { not: id } },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException('Impossible : dernier administrateur du système');
      }
    }

    const nextRole = dto.role ?? existing.role;
    const nextDeptId =
      dto.departmentId !== undefined ? dto.departmentId : existing.departmentId;
    if (nextRole !== 'ADMIN' && nextDeptId == null) {
      throw new BadRequestException(
        'Un département est requis pour ce rôle (sauf pour le profil administrateur global).',
      );
    }

    let passwordHash: string | undefined;
    if (dto.password) {
      passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const phoneUpdate =
      dto.phone != null ? normalizePhone(dto.phone) : undefined;

    const data: Prisma.UserUpdateInput = {
      ...(phoneUpdate !== undefined ? { phone: phoneUpdate } : {}),
      ...(passwordHash && { password: passwordHash }),
      ...(dto.role !== undefined ? { role: dto.role } : {}),
      ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      company:
        dto.companyId === null
          ? { disconnect: true }
          : dto.companyId !== undefined
            ? { connect: { id: dto.companyId } }
            : undefined,
      department:
        dto.departmentId === null
          ? { disconnect: true }
          : dto.departmentId !== undefined
            ? { connect: { id: dto.departmentId } }
            : undefined,
    };
    if (dto.email !== undefined) {
      data.email = dto.email.trim() === '' ? null : dto.email.trim();
    }

    await this.usersRepository.update(id, data);
    if (
      dto.departmentId !== undefined ||
      dto.departmentIds !== undefined ||
      dto.role !== undefined
    ) {
      await this.replaceManagedDepartments(id, nextRole, {
        departmentId: nextDeptId,
        departmentIds: dto.departmentIds,
      });
    }

    const updated = await this.usersRepository.findById(id);
    if (!updated) throw new NotFoundException('Utilisateur introuvable');
    await this.auditService.log({
      userId: actorId,
      action: 'USER_UPDATED',
      entity: 'User',
      entityId: String(id),
      metadata: { role: updated.role },
    });
    return this.toPublic(updated);
  }

  async remove(id: number, actingUserId: number) {
    if (id === actingUserId) {
      throw new BadRequestException('Vous ne pouvez pas supprimer votre propre compte');
    }
    const existing = await this.usersRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    if (existing.role === 'ADMIN') {
      const otherAdmins = await this.prisma.user.count({
        where: { role: 'ADMIN', id: { not: id } },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException('Impossible : dernier administrateur du système');
      }
    }
    const deleted = await this.usersRepository.delete(id);
    await this.auditService.log({
      userId: actingUserId,
      action: 'USER_DELETED',
      entity: 'User',
      entityId: String(id),
      metadata: { phone: existing.phone },
    });
    return this.toPublic(deleted);
  }

  private async replaceManagedDepartments(
    userId: number,
    role: string,
    opts: { departmentId?: number | null; departmentIds?: number[] },
  ) {
    if (role === 'ADMIN') {
      await this.prisma.userDepartment.updateMany({
        where: { userId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return;
    }

    const homeId = opts.departmentId ?? null;
    let wanted = isManagerRole(role)
      ? (opts.departmentIds?.length ? opts.departmentIds : homeId != null ? [homeId] : [])
      : homeId != null
        ? [homeId]
        : [];
    wanted = Array.from(new Set(wanted.filter((id) => Number.isFinite(id) && id > 0)));
    if (homeId != null && !wanted.includes(homeId)) {
      wanted = [homeId, ...wanted];
    }
    if (!wanted.length) return;

    const depts = await this.prisma.department.findMany({
      where: { id: { in: wanted }, deletedAt: null },
      select: { id: true, companyId: true },
    });
    if (depts.length !== wanted.length) {
      throw new BadRequestException('Un des départements est introuvable');
    }
    const companyIds = new Set(depts.map((d) => d.companyId));
    if (companyIds.size > 1) {
      throw new BadRequestException(
        'Les départements d’un gérant doivent appartenir à la même entreprise.',
      );
    }

    const existing = await this.prisma.userDepartment.findMany({
      where: { userId },
    });
    const wantedSet = new Set(wanted);
    const now = new Date();

    for (const row of existing) {
      if (wantedSet.has(row.departmentId)) {
        if (row.deletedAt) {
          await this.prisma.userDepartment.update({
            where: { id: row.id },
            data: { deletedAt: null },
          });
        }
      } else if (!row.deletedAt) {
        await this.prisma.userDepartment.update({
          where: { id: row.id },
          data: { deletedAt: now },
        });
      }
    }

    const existingIds = new Set(existing.map((r) => r.departmentId));
    for (const departmentId of wanted) {
      if (existingIds.has(departmentId)) continue;
      await this.prisma.userDepartment.create({
        data: { userId, departmentId },
      });
    }
  }
}
