import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ALL_PERMISSION_CODES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  permissionsSatisfy,
  SYSTEM_ROLE_LABELS,
} from '../../common/permissions';
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
    const code = dto.code.trim().toUpperCase().replace(/\s+/g, '_');
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) {
      throw new BadRequestException(
        'Code de rôle invalide (lettres/chiffres/_, commence par une lettre).',
      );
    }
    const existing = await this.prisma.appRole.findFirst({ where: { code } });
    if (existing) {
      throw new ConflictException('Ce code de rôle existe déjà.');
    }
    this.validatePermissions(dto.permissions);
    const created = await this.prisma.appRole.create({
      data: {
        code,
        label: dto.label.trim(),
        description: dto.description?.trim() || null,
        permissions: dto.permissions,
        isSystem: false,
      },
    });
    this.cache.delete(code);
    return created;
  }

  async update(id: number, dto: UpdateRoleDto) {
    const existing = await this.prisma.appRole.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Rôle introuvable');
    }
    if (dto.permissions) {
      this.validatePermissions(dto.permissions);
    }
    const updated = await this.prisma.appRole.update({
      where: { id },
      data: {
        label: dto.label?.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        permissions: dto.permissions,
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

  private validatePermissions(perms: string[]) {
    const allowed = new Set<string>(['*', ...ALL_PERMISSION_CODES]);
    for (const p of perms) {
      if (!allowed.has(p)) {
        throw new BadRequestException(`Autorisation inconnue : ${p}`);
      }
    }
  }

  private async ensureSystemRoles() {
    /** Permissions retirées des rôles système (ne doivent plus rester en base). */
    const revokedByRole: Record<string, string[]> = {
      CASHIER: ['config.view', 'config.manage'],
      /** Gérant : plus de vue globale argent / banque / compta (réactivable dans Rôles). */
      MANAGER: [
        'banks.view',
        'banks.manage',
        'accounting.view',
        'accounting.write',
        'accounting.manage',
        'company.manage',
        'reports.view',
        'finance.view',
        'finance.write',
      ],
    };
    /**
     * Nouvelles permissions catalogue à ajouter une fois (remplacent d’anciens hardcodes),
     * sans réinjecter tout le défaut MANAGER.
     */
    const grantIfMissingByRole: Record<string, string[]> = {
      MANAGER: ['sales.special_price', 'sales.recent_totals'],
      ACCOUNTANT: [
        'accounting.view',
        'accounting.write',
        'accounting.manage',
        'credit.view',
        'banks.view',
        'dashboard.synthesis',
        'reports.view',
        'stock.global',
      ],
      ADMIN: ['dashboard.synthesis', 'stock.global'],
    };

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
      if (existing.deletedAt || !existing.isActive) continue;
      if (existing.permissions.includes('*')) continue;

      const revoked = new Set(revokedByRole[code] ?? []);
      let next = existing.permissions.filter((p) => !revoked.has(p));
      for (const p of grantIfMissingByRole[code] ?? []) {
        if (!next.includes(p)) next = [...next, p];
      }
      const changed =
        next.length !== existing.permissions.length ||
        next.some((p, i) => p !== existing.permissions[i]);
      if (!changed) continue;

      await this.prisma.appRole.update({
        where: { id: existing.id },
        data: { permissions: next },
      });
      this.cache.delete(code);
    }
  }
}
