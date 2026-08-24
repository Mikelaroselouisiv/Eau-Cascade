import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';

type ScopeUser = {
  id?: number;
  role?: string;
  companyId?: number | null;
  departmentId?: number | null;
};

const deliveryInclude = {
  company: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  deliveredBy: { select: { id: true, fullName: true, phone: true } },
  sale: {
    select: {
      id: true,
      txnNumber: true,
      total: true,
      clientName: true,
      cashier: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, fullName: true, phone: true } },
    },
  },
  items: {
    include: {
      saleItem: {
        select: {
          id: true,
          lineLabel: true,
          quantity: true,
          unitPrice: true,
          subtotal: true,
          product: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { id: 'asc' as const },
  },
} satisfies Prisma.DeliveryInclude;

/** Numéro métier ticket = carte livraison (stable après sync). */
function saleRefOf(sale?: { id: number; txnNumber?: number | null } | null, saleId?: number) {
  if (sale) return sale.txnNumber ?? sale.id;
  return saleId ?? null;
}

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
  ) {}

  /** Crée la fiche livraison liée à une vente (même transaction). */
  async createFromSaleTx(
    tx: Prisma.TransactionClient,
    opts: {
      saleId: number;
      companyId: number;
      departmentId?: number | null;
      items: Array<{ saleItemId: number; quantityOrdered: number }>;
    },
  ) {
    const delivery = await tx.delivery.create({
      data: {
        saleId: opts.saleId,
        companyId: opts.companyId,
        departmentId: opts.departmentId ?? null,
        status: DeliveryStatus.PENDING,
        items: {
          create: opts.items.map((it) => ({
            saleItemId: it.saleItemId,
            quantityOrdered: it.quantityOrdered,
            quantityDelivered: 0,
          })),
        },
      },
    });
    return delivery;
  }

  /**
   * Garantit une fiche livraison pour une vente COMPLETED (API ou sync).
   * Crée la fiche manquante et complète les lignes absentes.
   */
  async ensureForSale(saleId: number) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, deletedAt: null },
      include: {
        items: {
          where: { deletedAt: null },
          include: {
            product: { select: { companyId: true, departmentId: true } },
          },
          orderBy: { id: 'asc' },
        },
        delivery: { include: { items: true } },
      },
    });
    if (!sale || sale.status !== 'COMPLETED' || !sale.items.length) {
      return null;
    }

    const companyId = sale.items[0]?.product?.companyId;
    if (companyId == null) return null;
    const departmentId =
      sale.items.find((it) => it.product.departmentId != null)?.product.departmentId ??
      null;

    if (!sale.delivery) {
      return this.createFromSaleTx(this.prisma, {
        saleId,
        companyId,
        departmentId,
        items: sale.items.map((it) => ({
          saleItemId: it.id,
          quantityOrdered: Number(it.quantity),
        })),
      });
    }

    const existingSaleItemIds = new Set(sale.delivery.items.map((i) => i.saleItemId));
    for (const it of sale.items) {
      if (existingSaleItemIds.has(it.id)) continue;
      await this.prisma.deliveryItem.create({
        data: {
          deliveryId: sale.delivery.id,
          saleItemId: it.id,
          quantityOrdered: Number(it.quantity),
          quantityDelivered: 0,
        },
      });
    }
    return sale.delivery;
  }

  /** Backfill des fiches manquantes pour les ventes déjà encaissées. */
  async ensureMissingForCompletedSales(limit = 500) {
    const sales = await this.prisma.sale.findMany({
      where: {
        status: 'COMPLETED',
        deletedAt: null,
        delivery: null,
      },
      select: { id: true },
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(limit, 1), 2000),
    });
    let created = 0;
    for (const s of sales) {
      const row = await this.ensureForSale(s.id);
      if (row) created += 1;
    }
    return { scanned: sales.length, created };
  }

  async list(
    user: ScopeUser,
    filters: {
      companyId?: number;
      departmentId?: number;
      status?: string;
      q?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const scope = this.resolveScope(user, filters);
    const status = this.parseStatus(filters.status);
    const take = Math.min(Math.max(filters.take ?? 100, 1), 100);
    const skip = Math.max(filters.skip ?? 0, 0);
    const q = filters.q?.trim() ?? '';

    const where: Prisma.DeliveryWhereInput = {
      deletedAt: null,
      sale: { status: 'COMPLETED', deletedAt: null },
      ...(scope.companyId != null ? { companyId: scope.companyId } : {}),
      ...(scope.departmentId != null ? { departmentId: scope.departmentId } : {}),
      ...(status ? { status } : {}),
    };

    if (q) {
      const asNum = Number.parseInt(q, 10);
      const or: Prisma.DeliveryWhereInput[] = [
        { sale: { clientName: { contains: q, mode: 'insensitive' } } },
      ];
      if (Number.isFinite(asNum) && String(asNum) === q) {
        or.push(
          { saleId: asNum },
          { id: asNum },
          { sale: { txnNumber: asNum } },
        );
      }
      where.OR = or;
    }

    const orderBy: Prisma.DeliveryOrderByWithRelationInput[] = [
      { status: 'asc' },
      { createdAt: 'desc' },
    ];

    let [total, rows] = await Promise.all([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
        where,
        include: deliveryInclude,
        orderBy,
        skip,
        take,
      }),
    ]);

    // Ventes arrivées via sync sans fiche : réparer puis recharger une fois.
    if (total === 0 && !q) {
      await this.ensureMissingForCompletedSales(500);
      [total, rows] = await Promise.all([
        this.prisma.delivery.count({ where }),
        this.prisma.delivery.findMany({
          where,
          include: deliveryInclude,
          orderBy,
          skip,
          take,
        }),
      ]);
    }

    return {
      items: rows.map((d) => this.withSaleRef(d)),
      total,
      skip,
      take,
    };
  }

  async findOne(id: number, user: ScopeUser) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, deletedAt: null },
      include: deliveryInclude,
    });
    if (!delivery) throw new NotFoundException('Livraison introuvable');
    this.assertCanAccess(user, delivery.companyId, delivery.departmentId);
    return this.withSaleRef(delivery);
  }

  /** Expose `saleRef` (= numéro imprimé sur le ticket) pour l’UI livraison. */
  private withSaleRef<T extends { saleId: number; sale?: { id: number; txnNumber?: number | null } | null }>(
    delivery: T,
  ) {
    return {
      ...delivery,
      saleRef: saleRefOf(delivery.sale, delivery.saleId),
    };
  }

  async update(id: number, dto: UpdateDeliveryDto, user: ScopeUser) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, deletedAt: null },
      include: { items: true, sale: { select: { id: true, status: true } } },
    });
    if (!delivery) throw new NotFoundException('Livraison introuvable');
    if (delivery.sale.status !== 'COMPLETED') {
      throw new BadRequestException('Cette vente n’est plus livrable');
    }
    this.assertCanAccess(user, delivery.companyId, delivery.departmentId);

    const targets = new Map<number, number>();
    for (const item of delivery.items) {
      targets.set(item.saleItemId, Number(item.quantityDelivered));
    }

    if (dto.markDelivered) {
      for (const item of delivery.items) {
        targets.set(item.saleItemId, Number(item.quantityOrdered));
      }
    } else if (dto.items?.length) {
      const bySaleItem = new Map(delivery.items.map((i) => [i.saleItemId, i]));
      for (const row of dto.items) {
        const existing = bySaleItem.get(row.saleItemId);
        if (!existing) {
          throw new BadRequestException(`Ligne ${row.saleItemId} introuvable`);
        }
        const ordered = Number(existing.quantityOrdered);
        if (row.quantityDelivered < -0.0001 || row.quantityDelivered > ordered + 0.0001) {
          throw new BadRequestException(
            `Quantité livrée invalide (ligne ${row.saleItemId})`,
          );
        }
        targets.set(row.saleItemId, row.quantityDelivered);
      }
    }

    return this.prisma.$transaction(
      async (tx) => {
        if (dto.note !== undefined) {
          await tx.delivery.update({
            where: { id },
            data: { note: dto.note?.trim() || null },
          });
        }

        for (const item of delivery.items) {
          const nextQty = targets.get(item.saleItemId);
          if (nextQty == null) continue;
          const prevQty = Number(item.quantityDelivered);
          const deltaSaleQty = nextQty - prevQty;

          // Toujours écrire la qté livrée avant / avec le stock (même transaction).
          if (Math.abs(nextQty - prevQty) > 0.0001) {
            await tx.deliveryItem.update({
              where: { id: item.id },
              data: { quantityDelivered: nextQty },
            });
          }

          if (Math.abs(deltaSaleQty) > 0.0001) {
            await this.applyStockDeltaForDeliveryItem(tx, {
              saleId: delivery.sale.id,
              saleItemId: item.saleItemId,
              deltaSaleQty,
              userId: user.id,
            });
          }
        }

        const items = await tx.deliveryItem.findMany({ where: { deliveryId: id } });
        const status = this.computeStatus(items);
        const updated = await tx.delivery.update({
          where: { id },
          data: {
            status,
            deliveredAt: status === DeliveryStatus.DELIVERED ? new Date() : null,
            deliveredById:
              status === DeliveryStatus.DELIVERED ? (user.id ?? null) : null,
          },
          include: deliveryInclude,
        });

        // Audit dans la même transaction (évite un journal « livré » si le commit échoue).
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'DELIVERY_UPDATED',
            entity: 'Delivery',
            entityId: String(id),
            metadata: { status: updated.status },
          },
        });

        return this.withSaleRef(updated);
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  /**
   * Sortie / réintégration stock selon le delta de quantité livrée (unités de vente → base).
   */
  private async applyStockDeltaForDeliveryItem(
    tx: Prisma.TransactionClient,
    opts: {
      saleId: number;
      saleItemId: number;
      deltaSaleQty: number;
      userId?: number;
    },
  ) {
    const saleItem = await tx.saleItem.findUnique({
      where: { id: opts.saleItemId },
      include: {
        product: { select: { id: true, name: true, trackStock: true, isService: true } },
      },
    });
    if (!saleItem) return;

    const saleQty = Number(saleItem.quantity);
    const baseFull = Number(saleItem.baseQuantity);
    if (saleQty <= 0) return;
    const baseDelta = (opts.deltaSaleQty / saleQty) * baseFull;
    if (Math.abs(baseDelta) <= 0.0001) return;

    const product = saleItem.product;
    const reason =
      baseDelta > 0
        ? `Livraison vente #${opts.saleId}`
        : `Correction livraison #${opts.saleId}`;

    if (product.isService) {
      const recipe = await tx.productRecipe.findUnique({
        where: { parentProductId: product.id },
        include: { components: true },
      });
      if (!recipe?.components.length) return;
      for (const c of recipe.components) {
        const need = Number(c.quantityPerParentBaseUnit) * baseDelta;
        if (Math.abs(need) <= 0.0001) continue;
        if (need > 0) {
          await this.inventoryService.ensureStockAvailabilityTx(tx, c.componentProductId, need);
          await this.inventoryService.decrementStockTx(
            tx,
            c.componentProductId,
            need,
            opts.userId,
            `${reason} — ${product.name}`,
          );
        } else {
          await tx.product.update({
            where: { id: c.componentProductId },
            data: { stock: { increment: Math.abs(need) } },
          });
          await tx.stockMovement.create({
            data: {
              productId: c.componentProductId,
              quantity: Math.abs(need),
              type: MovementType.IN,
              reason: `${reason} — ${product.name}`,
              createdById: opts.userId,
            },
          });
        }
      }
      return;
    }

    if (!product.trackStock) return;

    if (baseDelta > 0) {
      await this.inventoryService.ensureStockAvailabilityTx(tx, product.id, baseDelta);
      await this.inventoryService.decrementStockTx(
        tx,
        product.id,
        baseDelta,
        opts.userId,
        reason,
      );
    } else {
      await tx.product.update({
        where: { id: product.id },
        data: { stock: { increment: Math.abs(baseDelta) } },
      });
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          quantity: Math.abs(baseDelta),
          type: MovementType.IN,
          reason,
          createdById: opts.userId,
        },
      });
    }
  }

  private computeStatus(
    items: Array<{ quantityOrdered: Prisma.Decimal | number; quantityDelivered: Prisma.Decimal | number }>,
  ): DeliveryStatus {
    if (!items.length) return DeliveryStatus.PENDING;
    let any = false;
    let all = true;
    for (const it of items) {
      const ordered = Number(it.quantityOrdered);
      const delivered = Number(it.quantityDelivered);
      if (delivered > 0.0001) any = true;
      if (delivered + 0.0001 < ordered) all = false;
    }
    if (all && any) return DeliveryStatus.DELIVERED;
    if (any) return DeliveryStatus.PARTIAL;
    return DeliveryStatus.PENDING;
  }

  private resolveScope(
    user: ScopeUser,
    filters: { companyId?: number; departmentId?: number },
  ): { companyId?: number; departmentId?: number } {
    const role = user.role ?? '';
    // Caissier / livreur : toutes les fiches de leur entreprise (tous départements).
    // Le périmètre département s’applique à la caisse POS, pas aux livraisons.
    const locked = role === 'CASHIER' || role === 'LIVREUR';

    if (locked) {
      if (user.companyId == null) {
        throw new ForbiddenException('Affectation entreprise manquante');
      }
      return {
        companyId: user.companyId,
        departmentId: filters.departmentId,
      };
    }

    if (role === 'MANAGER' && user.companyId != null) {
      const companyId = filters.companyId ?? user.companyId;
      if (companyId !== user.companyId) {
        throw new ForbiddenException('Entreprise hors périmètre');
      }
      return {
        companyId,
        departmentId: filters.departmentId,
      };
    }

    return {
      companyId: filters.companyId,
      departmentId: filters.departmentId,
    };
  }

  private assertCanAccess(
    user: ScopeUser,
    companyId: number,
    _departmentId: number | null,
  ) {
    const role = user.role ?? '';
    if (role === 'ADMIN') return;

    if (role === 'CASHIER' || role === 'LIVREUR') {
      if (user.companyId == null || user.companyId !== companyId) {
        throw new ForbiddenException('Accès refusé');
      }
      return;
    }

    if (role === 'MANAGER' && user.companyId != null && user.companyId !== companyId) {
      throw new ForbiddenException('Accès refusé');
    }
  }

  private parseStatus(raw?: string): DeliveryStatus | undefined {
    if (!raw?.trim()) return undefined;
    const v = raw.trim().toUpperCase();
    if (v === 'PENDING' || v === 'PARTIAL' || v === 'DELIVERED') {
      return v as DeliveryStatus;
    }
    throw new BadRequestException('Statut de livraison invalide');
  }
}
