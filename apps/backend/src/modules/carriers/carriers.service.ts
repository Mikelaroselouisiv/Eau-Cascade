import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductNature } from '@prisma/client';
import { isProductionDepartment } from '../../common/department-kind';
import { permissionGranted } from '../../common/permissions';
import {
  canAccessAssignedDepartment,
  isAdminRole,
  isAssignedToDepartment,
  isManagerRole,
  resolvedDepartmentIds,
} from '../../common/user-scope';
import { ymdToBusinessDayEnd, ymdToBusinessDayStart, nowBusinessYmd } from '../../common/utils/business-timezone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RolesService } from '../roles/roles.service';
import type { CreateCarrierDto, UpdateCarrierDto } from './dto/carrier.dto';

const CARRIER_INCLUDE = {
  department: { select: { id: true, name: true, kind: true } },
  company: { select: { id: true, name: true } },
  rates: {
    include: { product: { select: { id: true, name: true } } },
    orderBy: { product: { name: 'asc' as const } },
  },
} as const;

type ScopeUser = {
  id: number;
  role?: string | null;
  companyId?: number | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
  productionDepartmentIds?: number[] | null;
};

@Injectable()
export class CarriersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rolesService: RolesService,
  ) {}

  private async canSeePayroll(user: ScopeUser) {
    if (!user.role) return false;
    const perms = await this.rolesService.getPermissionsForUserRole(user.role);
    return permissionGranted(perms, 'carriers.manage');
  }

  private assignedPlantIds(user: ScopeUser): number[] {
    const fromProduction = (user.productionDepartmentIds ?? []).filter((id) => id > 0);
    if (fromProduction.length) return fromProduction;
    return resolvedDepartmentIds(user);
  }

  private assertDeptAccess(user: ScopeUser, departmentId: number) {
    if (isAdminRole(user.role) || isManagerRole(user.role) || user.role === 'ACCOUNTANT') {
      if (!canAccessAssignedDepartment(user, departmentId)) {
        throw new ForbiddenException('Vous n’êtes pas affecté à ce département.');
      }
      return;
    }
    if (!isAssignedToDepartment({ ...user, departmentIds: this.assignedPlantIds(user) }, departmentId)) {
      throw new ForbiddenException('Vous n’êtes pas affecté à ce département.');
    }
  }

  private normalizePhone(phone: string) {
    return phone.trim();
  }

  private dateFilter(dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter | undefined {
    const createdAt: Prisma.DateTimeFilter = {};
    if (dateFrom?.trim()) {
      try {
        createdAt.gte = ymdToBusinessDayStart(dateFrom.trim());
      } catch {
        /* ignore */
      }
    }
    if (dateTo?.trim()) {
      try {
        createdAt.lte = ymdToBusinessDayEnd(dateTo.trim());
      } catch {
        /* ignore */
      }
    }
    return createdAt.gte || createdAt.lte ? createdAt : undefined;
  }

  private serialize(row: {
    payrollCoefficient?: unknown;
    rates?: Array<{ coefficient: Prisma.Decimal | number; product: { id: number; name: string }; productId: number }>;
    [k: string]: unknown;
  }) {
    return {
      ...row,
      rates: (row.rates ?? []).map((r) => ({
        productId: r.productId,
        name: r.product.name,
        coefficient: Number(r.coefficient),
      })),
    };
  }

  private async assertPlant(departmentId: number) {
    const dept = await this.prisma.department.findFirst({
      where: { id: departmentId, deletedAt: null },
    });
    if (!dept) throw new NotFoundException('Département introuvable');
    if (!isProductionDepartment(dept.kind)) {
      throw new BadRequestException('Ce département n’est pas une unité de production.');
    }
    return dept;
  }

  private async validateRates(companyId: number, departmentId: number, rates: Array<{ productId: number; coefficient: number }>) {
    const ids = rates.map((r) => r.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Produit en double dans les coefficients.');
    }
    if (ids.length === 0) return;
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const rate of rates) {
      const p = byId.get(rate.productId);
      if (!p) throw new NotFoundException(`Produit ${rate.productId} introuvable`);
      if (p.companyId !== companyId) {
        throw new BadRequestException(`« ${p.name} » n’appartient pas à cette entreprise.`);
      }
      if (p.departmentId !== departmentId) {
        throw new BadRequestException(`« ${p.name} » n’appartient pas à ce département.`);
      }
      if (p.nature === ProductNature.RAW_MATERIAL) {
        throw new BadRequestException(`« ${p.name} » est une matière première.`);
      }
    }
  }

  async list(
    departmentId: number,
    user: ScopeUser,
    opts?: { includeInactive?: boolean; dateFrom?: string; dateTo?: string },
  ) {
    this.assertDeptAccess(user, departmentId);
    await this.assertPlant(departmentId);
    const rows = await this.prisma.carrier.findMany({
      where: {
        departmentId,
        deletedAt: null,
        ...(opts?.includeInactive ? {} : { isActive: true }),
      },
      include: CARRIER_INCLUDE,
      orderBy: { name: 'asc' },
    });
    const dateTo = opts?.dateTo?.trim() || nowBusinessYmd();
    const dateFrom = opts?.dateFrom?.trim() || `${dateTo.slice(0, 8)}01`;
    const createdAt = this.dateFilter(dateFrom, dateTo);
    const sums =
      rows.length === 0
        ? []
        : await this.prisma.carrierTrip.groupBy({
            by: ['carrierId'],
            where: {
              carrierId: { in: rows.map((r) => r.id) },
              ...(createdAt ? { createdAt } : {}),
            },
            _sum: { quantity: true, payrollAmount: true },
          });
    const byId = new Map(sums.map((s) => [s.carrierId, s]));
    const showPay = await this.canSeePayroll(user);
    return rows.map((r) => {
      const serialized = this.serialize(r);
      if (!showPay) {
        const { rates: _rates, ...rest } = serialized;
        return {
          ...rest,
          rates: [],
          dateFrom,
          dateTo,
        };
      }
      const sum = byId.get(r.id)?._sum;
      return {
        ...serialized,
        dateFrom,
        dateTo,
        deliveredQty: Number(sum?.quantity ?? 0),
        payrollAmount: Number(sum?.payrollAmount ?? 0),
      };
    });
  }

  async getOne(id: number, user: ScopeUser, opts?: { dateFrom?: string; dateTo?: string }) {
    const carrier = await this.prisma.carrier.findFirst({
      where: { id, deletedAt: null },
      include: CARRIER_INCLUDE,
    });
    if (!carrier) throw new NotFoundException('Transporteur introuvable');
    this.assertDeptAccess(user, carrier.departmentId);

    const createdAt = this.dateFilter(opts?.dateFrom, opts?.dateTo);
    const trips = await this.prisma.carrierTrip.findMany({
      where: { carrierId: id, ...(createdAt ? { createdAt } : {}) },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const byProduct = new Map<number, { productId: number; name: string; quantity: number; payrollAmount: number }>();
    for (const row of trips) {
      const cur = byProduct.get(row.productId) ?? {
        productId: row.productId,
        name: row.product.name,
        quantity: 0,
        payrollAmount: 0,
      };
      cur.quantity += Number(row.quantity);
      cur.payrollAmount += Number(row.payrollAmount);
      byProduct.set(row.productId, cur);
    }

    return {
      ...this.serialize(carrier),
      dateFrom: opts?.dateFrom ?? null,
      dateTo: opts?.dateTo ?? null,
      deliveredQty: trips.reduce((s, r) => s + Number(r.quantity), 0),
      payrollAmount: trips.reduce((s, r) => s + Number(r.payrollAmount), 0),
      deliveredByProduct: [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    };
  }

  async create(dto: CreateCarrierDto, user: ScopeUser) {
    this.assertDeptAccess(user, dto.departmentId);
    const dept = await this.assertPlant(dto.departmentId);
    const phone = this.normalizePhone(dto.phone);
    const duplicate = await this.prisma.carrier.findFirst({
      where: { companyId: dept.companyId, phone, deletedAt: null },
    });
    if (duplicate) {
      throw new BadRequestException('Un transporteur avec ce téléphone existe déjà.');
    }
    await this.validateRates(dept.companyId, dto.departmentId, dto.rates ?? []);

    const row = await this.prisma.carrier.create({
      data: {
        companyId: dept.companyId,
        departmentId: dto.departmentId,
        name: dto.name.trim(),
        phone,
        createdById: user.id,
        rates: {
          create: (dto.rates ?? [])
            .filter((r) => Number(r.coefficient) > 0)
            .map((r) => ({ productId: r.productId, coefficient: r.coefficient })),
        },
      },
      include: CARRIER_INCLUDE,
    });

    await this.auditService.log({
      userId: user.id,
      action: 'CARRIER_CREATED',
      entity: 'Carrier',
      entityId: String(row.id),
      metadata: { departmentId: dto.departmentId },
    });

    return this.serialize(row);
  }

  async update(id: number, dto: UpdateCarrierDto, user: ScopeUser) {
    const existing = await this.prisma.carrier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Transporteur introuvable');
    this.assertDeptAccess(user, existing.departmentId);

    let nextDepartmentId = existing.departmentId;
    let nextCompanyId = existing.companyId;
    if (dto.departmentId != null && dto.departmentId !== existing.departmentId) {
      this.assertDeptAccess(user, dto.departmentId);
      const dept = await this.assertPlant(dto.departmentId);
      nextDepartmentId = dept.id;
      nextCompanyId = dept.companyId;
    }

    if (dto.phone != null) {
      const phone = this.normalizePhone(dto.phone);
      const duplicate = await this.prisma.carrier.findFirst({
        where: {
          companyId: existing.companyId,
          phone,
          deletedAt: null,
          NOT: { id },
        },
      });
      if (duplicate) {
        throw new BadRequestException('Un transporteur avec ce téléphone existe déjà.');
      }
    }

    if (dto.rates) {
      await this.validateRates(nextCompanyId, nextDepartmentId, dto.rates);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.rates) {
        await tx.carrierRate.deleteMany({ where: { carrierId: id } });
        const keep = dto.rates.filter((r) => Number(r.coefficient) > 0);
        if (keep.length) {
          await tx.carrierRate.createMany({
            data: keep.map((r) => ({
              carrierId: id,
              productId: r.productId,
              coefficient: r.coefficient,
            })),
          });
        }
      }
      return tx.carrier.update({
        where: { id },
        data: {
          departmentId: nextDepartmentId,
          companyId: nextCompanyId,
          ...(dto.name != null ? { name: dto.name.trim() } : {}),
          ...(dto.phone != null ? { phone: this.normalizePhone(dto.phone) } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        include: CARRIER_INCLUDE,
      });
    });

    await this.auditService.log({
      userId: user.id,
      action: 'CARRIER_UPDATED',
      entity: 'Carrier',
      entityId: String(id),
    });

    return this.serialize(row);
  }

  async requireForHomeDrop(
    tx: Prisma.TransactionClient,
    opts: { carrierId: number; departmentId: number; companyId: number },
  ) {
    const carrier = await tx.carrier.findFirst({
      where: { id: opts.carrierId, deletedAt: null },
    });
    if (!carrier) throw new BadRequestException('Transporteur introuvable');
    if (!carrier.isActive) throw new BadRequestException('Transporteur inactif');
    if (carrier.departmentId !== opts.departmentId) {
      throw new BadRequestException('Le transporteur n’appartient pas à ce département.');
    }
    if (carrier.companyId !== opts.companyId) {
      throw new BadRequestException('Le transporteur n’appartient pas à cette entreprise.');
    }
    return carrier;
  }

  async recordTripTx(
    tx: Prisma.TransactionClient,
    opts: {
      carrierId: number;
      departmentId: number;
      productId: number;
      quantity: number;
      userId?: number;
      deliveryId?: number | null;
      deliveryDropId?: number | null;
      internalTransferId?: number | null;
    },
  ) {
    const qty = Number(opts.quantity);
    if (!Number.isFinite(qty) || qty <= 0.0001) return null;
    const rate = await tx.carrierRate.findUnique({
      where: { carrierId_productId: { carrierId: opts.carrierId, productId: opts.productId } },
    });
    const coefficient = Number(rate?.coefficient ?? 0);
    return tx.carrierTrip.create({
      data: {
        carrierId: opts.carrierId,
        departmentId: opts.departmentId,
        deliveryId: opts.deliveryId ?? null,
        deliveryDropId: opts.deliveryDropId ?? null,
        internalTransferId: opts.internalTransferId ?? null,
        productId: opts.productId,
        quantity: qty,
        coefficient,
        payrollAmount: qty * coefficient,
        createdById: opts.userId ?? null,
      },
    });
  }
}
