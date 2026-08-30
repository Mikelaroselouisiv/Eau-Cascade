import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DepartmentKind,
  InternalTransferStatus,
  MovementType,
  Prisma,
  ProductNature,
  ProductionFlowKind,
} from '@prisma/client';
import { isProductionDepartment } from '../../common/department-kind';
import { resolveProductInDepartment } from '../../common/product-remap';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import { canAccessAssignedDepartment } from '../../common/user-scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProductionSessionsService } from '../production-sessions/production-sessions.service';
import type { CreateInternalTransferDto } from './dto/internal-transfer.dto';

const TRANSFER_INCLUDE = {
  fromDepartment: { select: { id: true, name: true, kind: true, companyId: true } },
  toDepartment: { select: { id: true, name: true, kind: true, companyId: true } },
  createdBy: { select: USER_ATTRIBUTION_SELECT },
  confirmedBy: { select: USER_ATTRIBUTION_SELECT },
  items: {
    include: { product: { select: { id: true, name: true, sku: true } } },
    orderBy: { id: 'asc' as const },
  },
};

type ScopeUser = {
  id: number;
  role?: string | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
};

@Injectable()
export class InternalTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly productionSessions: ProductionSessionsService,
  ) {}

  list(filters: {
    companyId?: number;
    fromDepartmentId?: number;
    toDepartmentId?: number;
    status?: InternalTransferStatus;
    inboxDepartmentIds?: number[];
  }) {
    const where: Prisma.InternalTransferWhereInput = { deletedAt: null };
    if (filters.companyId) where.companyId = filters.companyId;
    if (filters.fromDepartmentId) where.fromDepartmentId = filters.fromDepartmentId;
    if (filters.toDepartmentId) where.toDepartmentId = filters.toDepartmentId;
    if (filters.status) where.status = filters.status;
    if (filters.inboxDepartmentIds?.length) {
      where.toDepartmentId = { in: filters.inboxDepartmentIds };
    }
    return this.prisma.internalTransfer.findMany({
      where,
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async create(dto: CreateInternalTransferDto, user: ScopeUser) {
    if (dto.fromDepartmentId === dto.toDepartmentId) {
      throw new BadRequestException('Le destinataire doit être un autre département.');
    }
    if (!canAccessAssignedDepartment(user, dto.fromDepartmentId)) {
      throw new ForbiddenException('Vous n’êtes pas affecté au département expéditeur.');
    }

    const fromDept = await this.prisma.department.findFirst({
      where: { id: dto.fromDepartmentId, deletedAt: null },
    });
    const toDept = await this.prisma.department.findFirst({
      where: { id: dto.toDepartmentId, deletedAt: null },
    });
    if (!fromDept || !toDept) throw new NotFoundException('Département introuvable');
    if (fromDept.companyId !== toDept.companyId) {
      throw new BadRequestException('Les deux départements doivent appartenir à la même entreprise.');
    }
    if (!isProductionDepartment(fromDept.kind)) {
      throw new BadRequestException('Seule une unité de production peut expédier un transfert interne.');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.productionSessions.requireOpenSessionTx(tx, dto.fromDepartmentId);
    });

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const item of dto.items) {
      const p = byId.get(item.productId);
      if (!p) throw new NotFoundException(`Produit ${item.productId} introuvable`);
      if (p.departmentId !== dto.fromDepartmentId) {
        throw new BadRequestException(`« ${p.name} » n’appartient pas au département expéditeur.`);
      }
      if (p.nature === ProductNature.RAW_MATERIAL) {
        throw new BadRequestException(`« ${p.name} » est une matière première, pas un produit fini.`);
      }
    }

    const created = await this.prisma.internalTransfer.create({
      data: {
        companyId: fromDept.companyId,
        fromDepartmentId: dto.fromDepartmentId,
        toDepartmentId: dto.toDepartmentId,
        note: dto.note?.trim() || null,
        createdById: user.id,
        items: {
          create: dto.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
        },
      },
      include: TRANSFER_INCLUDE,
    });

    await this.auditService.log({
      userId: user.id,
      action: 'INTERNAL_TRANSFER_CREATED',
      entity: 'InternalTransfer',
      entityId: String(created.id),
      metadata: { fromDepartmentId: dto.fromDepartmentId, toDepartmentId: dto.toDepartmentId },
    });

    return created;
  }

  async confirm(id: number, user: ScopeUser) {
    const transfer = await this.prisma.internalTransfer.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                companyId: true,
                departmentId: true,
                nature: true,
              },
            },
          },
        },
        fromDepartment: true,
        toDepartment: true,
      },
    });
    if (!transfer) throw new NotFoundException('Transfert introuvable');
    if (transfer.status !== InternalTransferStatus.PENDING) {
      throw new BadRequestException('Ce transfert n’est plus en attente.');
    }
    if (!canAccessAssignedDepartment(user, transfer.toDepartmentId)) {
      throw new ForbiddenException('Vous n’êtes pas affecté au département destinataire.');
    }

    const destIsPlant = transfer.toDepartment.kind === DepartmentKind.PRODUCTION_DISTRIBUTION;

    await this.prisma.$transaction(async (tx) => {
      const open = await tx.productionSession.findFirst({
        where: {
          departmentId: transfer.fromDepartmentId,
          status: 'OPEN',
          deletedAt: null,
        },
        select: { id: true },
      });

      for (const item of transfer.items) {
        const qty = Number(item.quantity);
        await this.productionSessions.recordFlowTx(tx, {
          departmentId: transfer.fromDepartmentId,
          productId: item.productId,
          kind: ProductionFlowKind.FLOW_TRANSFER_OUT,
          quantity: qty,
          userId: user.id,
          productionSessionId: open?.id ?? null,
          internalTransferId: transfer.id,
        });

        if (destIsPlant) {
          const destProductId = await resolveProductInDepartment(tx, item.product, transfer.toDepartmentId);
          await this.productionSessions.recordFlowTx(tx, {
            departmentId: transfer.toDepartmentId,
            productId: destProductId,
            kind: ProductionFlowKind.TRANSFER_IN,
            quantity: qty,
            userId: user.id,
            internalTransferId: transfer.id,
          });
        } else {
          const destProductId = await resolveProductInDepartment(tx, item.product, transfer.toDepartmentId);
          await tx.product.update({
            where: { id: destProductId },
            data: { stock: { increment: qty } },
          });
          await tx.stockMovement.create({
            data: {
              productId: destProductId,
              quantity: qty,
              type: MovementType.IN,
              reason: `Transfert interne #${transfer.id}`,
              createdById: user.id,
            },
          });
        }
      }

      await tx.internalTransfer.update({
        where: { id: transfer.id },
        data: {
          status: InternalTransferStatus.CONFIRMED,
          confirmedById: user.id,
          confirmedAt: new Date(),
        },
      });
    });

    await this.auditService.log({
      userId: user.id,
      action: 'INTERNAL_TRANSFER_CONFIRMED',
      entity: 'InternalTransfer',
      entityId: String(id),
    });

    return this.prisma.internalTransfer.findFirst({
      where: { id },
      include: TRANSFER_INCLUDE,
    });
  }

  async reject(id: number, user: ScopeUser) {
    const transfer = await this.prisma.internalTransfer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!transfer) throw new NotFoundException('Transfert introuvable');
    if (transfer.status !== InternalTransferStatus.PENDING) {
      throw new BadRequestException('Ce transfert n’est plus en attente.');
    }
    if (!canAccessAssignedDepartment(user, transfer.toDepartmentId)) {
      throw new ForbiddenException('Vous n’êtes pas affecté au département destinataire.');
    }

    const updated = await this.prisma.internalTransfer.update({
      where: { id },
      data: {
        status: InternalTransferStatus.REJECTED,
        confirmedById: user.id,
        rejectedAt: new Date(),
      },
      include: TRANSFER_INCLUDE,
    });

    await this.auditService.log({
      userId: user.id,
      action: 'INTERNAL_TRANSFER_REJECTED',
      entity: 'InternalTransfer',
      entityId: String(id),
    });

    return updated;
  }
}
