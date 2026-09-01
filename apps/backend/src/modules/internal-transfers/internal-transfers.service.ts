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
import { holdsFinishedGoodsStock, isProductionDepartment } from '../../common/department-kind';
import { resolveProductInDepartment } from '../../common/product-remap';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import {
  isAdminRole,
  isAssignedToDepartment,
  isManagerRole,
  resolvedDepartmentIds,
} from '../../common/user-scope';
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
  companyId?: number | null;
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

  async list(
    user: ScopeUser,
    filters: {
      companyId?: number;
      fromDepartmentId?: number;
      toDepartmentId?: number;
      status?: InternalTransferStatus;
      inbox?: boolean;
    },
  ) {
    const where: Prisma.InternalTransferWhereInput = { deletedAt: null };
    if (filters.companyId) where.companyId = filters.companyId;
    if (filters.fromDepartmentId) where.fromDepartmentId = filters.fromDepartmentId;
    if (filters.toDepartmentId) where.toDepartmentId = filters.toDepartmentId;
    if (filters.status) where.status = filters.status;

    if (filters.inbox) {
      const destIds = await this.receptionInboxDepartmentIds(user, filters.toDepartmentId);
      if (!destIds.length) return [];
      where.toDepartmentId = { in: destIds };
      if (!filters.status) where.status = InternalTransferStatus.PENDING;
    } else {
      const scoped = this.applyViewerScope(user, where, filters);
      if (scoped === 'empty') return [];
    }

    return this.prisma.internalTransfer.findMany({
      where,
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Magasins DISTRIBUTION du caissier — pas les usines, pas le gérant. */
  private async receptionInboxDepartmentIds(
    user: ScopeUser,
    requestedToDepartmentId?: number,
  ): Promise<number[]> {
    if (!isAdminRole(user.role) && user.role !== 'CASHIER') return [];
    const assigned = resolvedDepartmentIds(user);
    if (!assigned.length) return [];
    const shops = await this.prisma.department.findMany({
      where: {
        id: { in: assigned },
        deletedAt: null,
        kind: DepartmentKind.DISTRIBUTION,
      },
      select: { id: true },
    });
    let ids = shops.map((d) => d.id);
    if (requestedToDepartmentId != null) {
      ids = ids.filter((id) => id === requestedToDepartmentId);
    }
    return ids;
  }

  private applyViewerScope(
    user: ScopeUser,
    where: Prisma.InternalTransferWhereInput,
    filters: { fromDepartmentId?: number; toDepartmentId?: number; companyId?: number },
  ): 'ok' | 'empty' {
    if (isAdminRole(user.role)) return 'ok';
    if (isManagerRole(user.role)) {
      if (user.companyId != null && !filters.companyId) {
        where.companyId = user.companyId;
      }
      return 'ok';
    }
    const assigned = resolvedDepartmentIds(user);
    if (!assigned.length) return 'empty';
    if (filters.fromDepartmentId && !assigned.includes(filters.fromDepartmentId)) return 'empty';
    if (filters.toDepartmentId && !assigned.includes(filters.toDepartmentId)) return 'empty';
    if (!filters.fromDepartmentId && !filters.toDepartmentId) {
      where.OR = [
        { fromDepartmentId: { in: assigned } },
        { toDepartmentId: { in: assigned } },
      ];
    }
    return 'ok';
  }

  private assertCanConfirmReception(
    user: ScopeUser,
    dest: { id: number; kind: DepartmentKind | string; name: string },
  ) {
    if (isAdminRole(user.role)) return;
    if (!holdsFinishedGoodsStock(dest.kind) || user.role !== 'CASHIER') {
      throw new ForbiddenException(
        'Seul le caissier du magasin destinataire peut confirmer la réception.',
      );
    }
    if (!isAssignedToDepartment(user, dest.id)) {
      throw new ForbiddenException('Cette réception n’est pas destinée à votre magasin.');
    }
  }

  /** Gérant : n’importe quelle usine de son entreprise. Chef : usine affectée. Session ouverte obligatoire à l’envoi. */
  private assertCanDispatch(
    user: ScopeUser,
    fromDept: { id: number; companyId: number },
  ) {
    if (isAdminRole(user.role)) return;
    if (isManagerRole(user.role)) {
      if (user.companyId != null && fromDept.companyId !== user.companyId) {
        throw new ForbiddenException('Hors de votre entreprise.');
      }
      return;
    }
    if (!isAssignedToDepartment(user, fromDept.id)) {
      throw new ForbiddenException('Vous n’êtes pas affecté au département expéditeur.');
    }
  }

  async create(dto: CreateInternalTransferDto, user: ScopeUser) {
    if (dto.fromDepartmentId === dto.toDepartmentId) {
      throw new BadRequestException('Le destinataire doit être un autre département.');
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
    this.assertCanDispatch(user, fromDept);

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

    const destIsPlant = isProductionDepartment(toDept.kind);
    const created = await this.prisma.$transaction(async (tx) => {
      const session = await this.productionSessions.requireOpenSessionTx(tx, dto.fromDepartmentId);

      const row = await tx.internalTransfer.create({
        data: {
          companyId: fromDept.companyId,
          fromDepartmentId: dto.fromDepartmentId,
          toDepartmentId: dto.toDepartmentId,
          note: dto.note?.trim() || null,
          createdById: user.id,
          status: destIsPlant ? InternalTransferStatus.CONFIRMED : InternalTransferStatus.PENDING,
          ...(destIsPlant
            ? { confirmedById: user.id, confirmedAt: new Date() }
            : {}),
          items: {
            create: dto.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
            })),
          },
        },
        include: TRANSFER_INCLUDE,
      });

      for (const item of dto.items) {
        const qty = Number(item.quantity);
        await this.productionSessions.recordFlowTx(tx, {
          departmentId: dto.fromDepartmentId,
          productId: item.productId,
          kind: ProductionFlowKind.FLOW_TRANSFER_OUT,
          quantity: qty,
          userId: user.id,
          productionSessionId: session.id,
          internalTransferId: row.id,
        });
        if (destIsPlant) {
          const destProductId = await resolveProductInDepartment(tx, byId.get(item.productId)!, dto.toDepartmentId);
          await this.productionSessions.recordFlowTx(tx, {
            departmentId: dto.toDepartmentId,
            productId: destProductId,
            kind: ProductionFlowKind.TRANSFER_IN,
            quantity: qty,
            userId: user.id,
            internalTransferId: row.id,
          });
        }
      }

      return row;
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
    this.assertCanConfirmReception(user, transfer.toDepartment);

    const destIsPlant = isProductionDepartment(transfer.toDepartment.kind);

    await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        const qty = Number(item.quantity);
        if (destIsPlant) {
          const destProductId = await resolveProductInDepartment(
            tx,
            item.product,
            transfer.toDepartmentId,
          );
          await this.productionSessions.recordFlowTx(tx, {
            departmentId: transfer.toDepartmentId,
            productId: destProductId,
            kind: ProductionFlowKind.TRANSFER_IN,
            quantity: qty,
            userId: user.id,
            internalTransferId: transfer.id,
          });
        } else {
          const destProductId = await resolveProductInDepartment(
            tx,
            item.product,
            transfer.toDepartmentId,
          );
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
    const dest = await this.prisma.department.findFirst({
      where: { id: transfer.toDepartmentId, deletedAt: null },
      select: { id: true, kind: true, name: true },
    });
    if (!dest) throw new NotFoundException('Département introuvable');
    this.assertCanConfirmReception(user, dest);

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
