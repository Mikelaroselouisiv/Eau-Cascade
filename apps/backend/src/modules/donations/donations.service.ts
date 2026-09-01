import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProductNature,
  ProductionFlowKind,
} from '@prisma/client';
import {
  isProductionDepartment,
  shouldEnforceFinishedGoodsAvailability,
} from '../../common/department-kind';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import { canAccessAssignedDepartment } from '../../common/user-scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { ProductionSessionsService } from '../production-sessions/production-sessions.service';
import {
  CreateDonationBeneficiaryDto,
  CreateDonationDto,
  UpdateDonationBeneficiaryDto,
} from './dto/donation.dto';

const BENEFICIARY_INCLUDE = {
  department: { select: { id: true, name: true, kind: true } },
  company: { select: { id: true, name: true } },
} as const;

const DONATION_INCLUDE = {
  department: { select: { id: true, name: true, kind: true } },
  beneficiary: { select: { id: true, name: true } },
  createdBy: { select: USER_ATTRIBUTION_SELECT },
  items: {
    include: { product: { select: { id: true, name: true, sku: true } } },
    orderBy: { id: 'asc' as const },
  },
};

type ScopeUser = {
  id: number;
  role?: string | null;
  companyId?: number | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
};

@Injectable()
export class DonationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
    private readonly productionSessions: ProductionSessionsService,
  ) {}

  async summary(companyId: number) {
    const [beneficiariesTotal, donationAgg, last] = await Promise.all([
      this.prisma.donationBeneficiary.count({
        where: { companyId, deletedAt: null, isActive: true },
      }),
      this.prisma.donationItem.aggregate({
        where: { deletedAt: null, donation: { companyId, deletedAt: null } },
        _sum: { quantity: true },
        _count: { id: true },
      }),
      this.prisma.donation.findFirst({
        where: { companyId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    const donationsTotal = await this.prisma.donation.count({
      where: { companyId, deletedAt: null },
    });
    return {
      beneficiariesTotal,
      donationsTotal,
      itemsTotal: donationAgg._count.id,
      quantityTotal: Number(donationAgg._sum.quantity ?? 0),
      lastDonationAt: last?.createdAt ?? null,
    };
  }

  async listBeneficiaries(companyId: number, opts?: { q?: string; includeInactive?: boolean }) {
    const q = opts?.q?.trim();
    const rows = await this.prisma.donationBeneficiary.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(opts?.includeInactive ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: BENEFICIARY_INCLUDE,
      orderBy: { name: 'asc' },
    });
    const ids = rows.map((r) => r.id);
    const grouped =
      ids.length === 0
        ? []
        : await this.prisma.donation.groupBy({
            by: ['beneficiaryId'],
            where: { beneficiaryId: { in: ids }, deletedAt: null },
            _count: { id: true },
            _max: { createdAt: true },
          });
    const byId = new Map(grouped.map((g) => [g.beneficiaryId, g]));
    return rows.map((r) => {
      const stats = byId.get(r.id);
      return {
        ...r,
        donationsCount: stats?._count.id ?? 0,
        lastDonationAt: stats?._max.createdAt ?? null,
      };
    });
  }

  async getBeneficiary(id: number) {
    const beneficiary = await this.prisma.donationBeneficiary.findFirst({
      where: { id, deletedAt: null },
      include: BENEFICIARY_INCLUDE,
    });
    if (!beneficiary) throw new NotFoundException('Bénéficiaire introuvable');

    const donations = await this.prisma.donation.findMany({
      where: { beneficiaryId: id, deletedAt: null },
      include: DONATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const donationsCount = donations.length;
    const quantityTotal = donations.reduce(
      (sum, d) => sum + d.items.reduce((s, i) => s + Number(i.quantity), 0),
      0,
    );

    return {
      ...beneficiary,
      donationsCount,
      lastDonationAt: donations[0]?.createdAt ?? null,
      quantityTotal,
      donations: donations.map((d) => ({
        ...d,
        items: d.items.map((i) => ({ ...i, quantity: Number(i.quantity) })),
      })),
    };
  }

  async createBeneficiary(dto: CreateDonationBeneficiaryDto, userId?: number) {
    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable');
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, companyId: dto.companyId, deletedAt: null },
      });
      if (!dept) throw new BadRequestException('Département introuvable pour cette entreprise.');
    }
    const row = await this.prisma.donationBeneficiary.create({
      data: {
        companyId: dto.companyId,
        departmentId: dto.departmentId ?? null,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        address: dto.address?.trim() || null,
        note: dto.note?.trim() || null,
      },
      include: BENEFICIARY_INCLUDE,
    });
    await this.auditService.log({
      userId,
      action: 'DONATION_BENEFICIARY_CREATED',
      entity: 'DonationBeneficiary',
      entityId: String(row.id),
    });
    return { ...row, donationsCount: 0, lastDonationAt: null };
  }

  async updateBeneficiary(id: number, dto: UpdateDonationBeneficiaryDto, userId?: number) {
    const existing = await this.prisma.donationBeneficiary.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Bénéficiaire introuvable');
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, companyId: existing.companyId, deletedAt: null },
      });
      if (!dept) throw new BadRequestException('Département introuvable pour cette entreprise.');
    }
    const row = await this.prisma.donationBeneficiary.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: BENEFICIARY_INCLUDE,
    });
    await this.auditService.log({
      userId,
      action: 'DONATION_BENEFICIARY_UPDATED',
      entity: 'DonationBeneficiary',
      entityId: String(id),
    });
    return row;
  }

  async listDonations(filters: {
    companyId: number;
    beneficiaryId?: number;
    departmentId?: number;
  }) {
    const rows = await this.prisma.donation.findMany({
      where: {
        companyId: filters.companyId,
        deletedAt: null,
        ...(filters.beneficiaryId ? { beneficiaryId: filters.beneficiaryId } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      },
      include: DONATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((d) => ({
      ...d,
      items: d.items.map((i) => ({ ...i, quantity: Number(i.quantity) })),
    }));
  }

  async createDonation(dto: CreateDonationDto, user: ScopeUser) {
    if (!canAccessAssignedDepartment(user, dto.departmentId)) {
      throw new ForbiddenException('Vous n’êtes pas affecté à ce département.');
    }
    const beneficiary = await this.prisma.donationBeneficiary.findFirst({
      where: { id: dto.beneficiaryId, deletedAt: null },
    });
    if (!beneficiary) throw new NotFoundException('Bénéficiaire introuvable');
    if (!beneficiary.isActive) throw new BadRequestException('Bénéficiaire inactif');

    const dept = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, deletedAt: null },
    });
    if (!dept) throw new NotFoundException('Département introuvable');
    if (dept.companyId !== beneficiary.companyId) {
      throw new BadRequestException('Le département n’appartient pas à l’entreprise du bénéficiaire.');
    }

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      include: { department: { select: { kind: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    for (const item of dto.items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException('Quantité invalide.');
      }
      const p = byId.get(item.productId);
      if (!p) throw new NotFoundException(`Produit ${item.productId} introuvable`);
      if (p.departmentId !== dto.departmentId) {
        throw new BadRequestException(`« ${p.name} » n’appartient pas au département choisi.`);
      }
      if (p.nature === ProductNature.RAW_MATERIAL) {
        throw new BadRequestException(`« ${p.name} » est une matière première, pas un produit fini.`);
      }
    }

    const plant = isProductionDepartment(dept.kind);
    const created = await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        const p = byId.get(item.productId)!;
        if (
          shouldEnforceFinishedGoodsAvailability({
            departmentKind: dept.kind,
            nature: p.nature,
            trackStock: p.trackStock,
            isService: p.isService,
          })
        ) {
          await this.inventoryService.ensureStockAvailabilityTx(tx, p.id, item.quantity);
        }
      }

      const session = plant
        ? await this.productionSessions.requireOpenSessionTx(tx, dto.departmentId)
        : null;

      const row = await tx.donation.create({
        data: {
          companyId: beneficiary.companyId,
          departmentId: dto.departmentId,
          beneficiaryId: dto.beneficiaryId,
          note: dto.note?.trim() || null,
          createdById: user.id,
          items: {
            create: dto.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
            })),
          },
        },
        include: DONATION_INCLUDE,
      });

      for (const item of dto.items) {
        const qty = Number(item.quantity);
        if (plant) {
          await this.productionSessions.recordFlowTx(tx, {
            departmentId: dto.departmentId,
            productId: item.productId,
            kind: ProductionFlowKind.FLOW_DONATION,
            quantity: qty,
            userId: user.id,
            productionSessionId: session!.id,
            donationId: row.id,
          });
        } else {
          await this.inventoryService.decrementStockTx(
            tx,
            item.productId,
            qty,
            user.id,
            `Don #${row.id} — ${beneficiary.name}`,
          );
        }
      }

      return row;
    });

    await this.auditService.log({
      userId: user.id,
      action: 'DONATION_RECORDED',
      entity: 'Donation',
      entityId: String(created.id),
      metadata: { beneficiaryId: dto.beneficiaryId, departmentId: dto.departmentId },
    });

    return {
      ...created,
      items: created.items.map((i) => ({ ...i, quantity: Number(i.quantity) })),
    };
  }
}
