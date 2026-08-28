import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus, FulfillmentType, MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  canAccessAssignedDepartment,
  canEditDeliveryExecutor,
  resolvedDepartmentIds,
} from '../../common/user-scope';
import { canManageDeliveryFulfillment } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { RolesService } from '../roles/roles.service';
import { InventoryService } from '../inventory/inventory.service';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { CreateDeliveryDropDto } from './dto/create-delivery-drop.dto';

type ScopeUser = {
  id?: number;
  role?: string;
  companyId?: number | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
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
      clientPhone: true,
      clientAddress: true,
      cashier: true,
      fulfillmentType: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, fullName: true, phone: true } },
      deliveryStops: {
        select: { id: true, address: true, quantity: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' as const },
      },
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
  drops: {
    include: {
      department: { select: { id: true, name: true } },
      stop: { select: { id: true, address: true, quantity: true } },
    },
    orderBy: { createdAt: 'asc' as const },
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
    private readonly rolesService: RolesService,
  ) {}

  /** Crée la fiche livraison liée à une vente (même transaction). */
  async createFromSaleTx(
    tx: Prisma.TransactionClient,
    opts: {
      saleId: number;
      companyId: number;
      departmentId?: number | null;
      fulfillmentType?: FulfillmentType;
      items: Array<{ saleItemId: number; quantityOrdered: number }>;
    },
  ) {
    const fulfillmentType = opts.fulfillmentType ?? FulfillmentType.ON_SITE;
    const delivery = await tx.delivery.create({
      data: {
        saleId: opts.saleId,
        companyId: opts.companyId,
        fulfillmentType,
        // À domicile : le dépt source n’est connu qu’à la validation.
        departmentId:
          fulfillmentType === FulfillmentType.HOME ? null : (opts.departmentId ?? null),
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
    const fulfillmentType = sale.fulfillmentType ?? FulfillmentType.ON_SITE;
    const departmentId =
      fulfillmentType === FulfillmentType.HOME
        ? null
        : (sale.items.find((it) => it.product.departmentId != null)?.product.departmentId ??
          null);

    if (!sale.delivery) {
      return this.createFromSaleTx(this.prisma, {
        saleId,
        companyId,
        departmentId,
        fulfillmentType,
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
      fulfillmentType?: string;
      q?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const scope = this.resolveScope(user, filters);
    const status = this.parseStatus(filters.status);
    const fulfillmentType = this.parseFulfillmentType(filters.fulfillmentType);
    const take = Math.min(Math.max(filters.take ?? 100, 1), 100);
    const skip = Math.max(filters.skip ?? 0, 0);
    const q = filters.q?.trim() ?? '';

    const where: Prisma.DeliveryWhereInput = {
      deletedAt: null,
      sale: { status: 'COMPLETED', deletedAt: null },
      ...(scope.companyId != null ? { companyId: scope.companyId } : {}),
      ...this.departmentListClause(scope),
      ...(status ? { status } : {}),
      ...(fulfillmentType ? { fulfillmentType } : {}),
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
  private withSaleRef<
    T extends {
      saleId: number;
      items?: Array<{
        quantityOrdered: Prisma.Decimal | number | string;
        quantityDelivered: Prisma.Decimal | number | string;
      }>;
      drops?: Array<{
        quantity: Prisma.Decimal | number | string;
        stopId?: number | null;
      }>;
      sale?: {
        id: number;
        txnNumber?: number | null;
        deliveryStops?: Array<{
          id: number;
          quantity: Prisma.Decimal | number | string;
        }>;
      } | null;
    },
  >(delivery: T) {
    const items = (delivery.items ?? []).map((it) => {
      const ordered = Number(it.quantityOrdered);
      const delivered = Number(it.quantityDelivered);
      return {
        ...it,
        quantityRemaining: Math.max(0, ordered - delivered),
      };
    });
    const dropQtyByStop = new Map<number, number>();
    for (const drop of delivery.drops ?? []) {
      if (drop.stopId == null) continue;
      dropQtyByStop.set(
        drop.stopId,
        (dropQtyByStop.get(drop.stopId) ?? 0) + Number(drop.quantity),
      );
    }
    const deliveryStops = (delivery.sale?.deliveryStops ?? []).map((st) => {
      const delivered = dropQtyByStop.get(st.id) ?? 0;
      const planned = Number(st.quantity);
      return {
        ...st,
        quantityDelivered: delivered,
        quantityRemaining: Math.max(0, planned - delivered),
      };
    });
    const sale = delivery.sale
      ? { ...delivery.sale, deliveryStops }
      : delivery.sale;
    return {
      ...delivery,
      items,
      sale,
      saleRef: saleRefOf(delivery.sale, delivery.saleId),
    };
  }

  async addDrop(id: number, dto: CreateDeliveryDropDto, user: ScopeUser) {
    return this.applyDropsAndReload(
      id,
      [
        {
          saleItemId: dto.saleItemId,
          quantity: dto.quantity,
          departmentId: dto.departmentId,
          executorName: dto.executorName,
          stopId: dto.stopId ?? null,
        },
      ],
      user,
    );
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
    await this.assertCanManageFulfillment(user, delivery.fulfillmentType);

    const isHome = delivery.fulfillmentType === FulfillmentType.HOME;

    if (isHome && dto.executorName !== undefined) {
      const nextName = dto.executorName?.trim() || null;
      const prevName = delivery.executorName?.trim() || null;
      if (prevName && nextName !== prevName && !canEditDeliveryExecutor(user.role)) {
        throw new ForbiddenException(
          'Seul un administrateur ou un gérant peut modifier le nom de la personne qui a exécuté la livraison.',
        );
      }
    }

    const planned: Array<{
      saleItemId: number;
      quantity: number;
      departmentId: number;
      executorName?: string | null;
      stopId?: number | null;
    }> = [];

    const deptForDrop = dto.stockDepartmentId ?? delivery.departmentId;
    if (dto.markDelivered) {
      if (deptForDrop == null) {
        throw new BadRequestException('Choisissez le département de cette livraison.');
      }
      for (const item of delivery.items) {
        const remaining = Number(item.quantityOrdered) - Number(item.quantityDelivered);
        if (remaining > 0.0001) {
          planned.push({
            saleItemId: item.saleItemId,
            quantity: remaining,
            departmentId: deptForDrop,
            executorName: dto.executorName,
            stopId: dto.stopId ?? null,
          });
        }
      }
    } else if (dto.items?.length) {
      if (deptForDrop == null) {
        const anyIncrease = dto.items.some((row) => {
          const existing = delivery.items.find((i) => i.saleItemId === row.saleItemId);
          return existing != null && row.quantityDelivered > Number(existing.quantityDelivered) + 0.0001;
        });
        if (anyIncrease) {
          throw new BadRequestException('Choisissez le département de cette livraison.');
        }
      }
      const bySaleItem = new Map(delivery.items.map((i) => [i.saleItemId, i]));
      for (const row of dto.items) {
        const existing = bySaleItem.get(row.saleItemId);
        if (!existing) {
          throw new BadRequestException(`Ligne ${row.saleItemId} introuvable`);
        }
        const prev = Number(existing.quantityDelivered);
        const next = row.quantityDelivered;
        if (next + 0.0001 < prev) {
          throw new BadRequestException(
            'Ajoutez une nouvelle ligne pour livrer davantage ; on ne diminue pas une quantité déjà livrée.',
          );
        }
        const delta = next - prev;
        if (delta > 0.0001 && deptForDrop != null) {
          planned.push({
            saleItemId: row.saleItemId,
            quantity: delta,
            departmentId: deptForDrop,
            executorName: dto.executorName,
            stopId: dto.stopId ?? null,
          });
        }
      }
    }

    if (planned.length) {
      return this.applyDropsAndReload(id, planned, user, {
        note: dto.note,
        executorName: isHome ? dto.executorName : undefined,
      });
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: {
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        ...(isHome && dto.executorName !== undefined
          ? { executorName: dto.executorName?.trim() || null }
          : {}),
      },
      include: deliveryInclude,
    });
    return this.withSaleRef(updated);
  }

  private async applyDropsAndReload(
    id: number,
    drops: Array<{
      saleItemId: number;
      quantity: number;
      departmentId: number;
      executorName?: string | null;
      stopId?: number | null;
    }>,
    user: ScopeUser,
    extras?: { note?: string | null; executorName?: string | null },
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: true,
        sale: { select: { id: true, status: true } },
      },
    });
    if (!delivery) throw new NotFoundException('Livraison introuvable');
    if (delivery.sale.status !== 'COMPLETED') {
      throw new BadRequestException('Cette vente n’est plus livrable');
    }
    this.assertCanAccess(user, delivery.companyId, delivery.departmentId);
    await this.assertCanManageFulfillment(user, delivery.fulfillmentType);

    const isHome = delivery.fulfillmentType === FulfillmentType.HOME;

    return this.prisma.$transaction(
      async (tx) => {
        if (extras?.note !== undefined) {
          await tx.delivery.update({
            where: { id },
            data: { note: extras.note?.trim() || null },
          });
        }

        for (const drop of drops) {
          await this.applyDropTx(tx, {
            delivery,
            saleItemId: drop.saleItemId,
            quantity: drop.quantity,
            departmentId: drop.departmentId,
            executorName: drop.executorName,
            stopId: drop.stopId ?? null,
            user,
          });
        }

        const items = await tx.deliveryItem.findMany({ where: { deliveryId: id } });
        const status = this.computeStatus(items);
        const lastExecutor = [...drops].reverse().find((d) => d.executorName?.trim())?.executorName?.trim();
        const lastDept = drops[drops.length - 1]?.departmentId;
        const updated = await tx.delivery.update({
          where: { id },
          data: {
            status,
            deliveredAt: status === DeliveryStatus.DELIVERED ? new Date() : null,
            deliveredById: status === DeliveryStatus.DELIVERED ? (user.id ?? null) : null,
            ...(lastDept != null && delivery.departmentId == null
              ? { departmentId: lastDept }
              : {}),
            ...(isHome && (extras?.executorName !== undefined || lastExecutor)
              ? {
                  executorName:
                    extras?.executorName !== undefined
                      ? extras.executorName?.trim() || null
                      : lastExecutor ?? delivery.executorName,
                }
              : {}),
          },
          include: deliveryInclude,
        });

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'DELIVERY_UPDATED',
            entity: 'Delivery',
            entityId: String(id),
            metadata: { status: updated.status, drops: drops.length },
          },
        });

        return this.withSaleRef(updated);
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  private async applyDropTx(
    tx: Prisma.TransactionClient,
    opts: {
      delivery: {
        id: number;
        sale: { id: number };
        companyId: number;
        fulfillmentType: FulfillmentType;
        items: Array<{
          saleItemId: number;
          quantityOrdered: Prisma.Decimal;
          quantityDelivered: Prisma.Decimal;
        }>;
      };
      saleItemId: number;
      quantity: number;
      departmentId: number;
      executorName?: string | null;
      stopId?: number | null;
      user: ScopeUser;
    },
  ) {
    const qty = Number(opts.quantity);
    if (!Number.isFinite(qty) || qty <= 0.0001) {
      throw new BadRequestException('Quantité livrée invalide');
    }
    const item = opts.delivery.items.find((i) => i.saleItemId === opts.saleItemId);
    if (!item) {
      throw new BadRequestException(`Ligne ${opts.saleItemId} introuvable`);
    }
    const remaining = Number(item.quantityOrdered) - Number(item.quantityDelivered);
    if (qty > remaining + 0.0001) {
      throw new BadRequestException(
        `Quantité trop élevée (reste à livrer : ${remaining})`,
      );
    }

    const isHome = opts.delivery.fulfillmentType === FulfillmentType.HOME;
    let departmentId = opts.departmentId;
    if (isHome) {
      departmentId = await this.assertHomeStockDepartment(
        departmentId,
        opts.delivery.companyId,
        opts.user,
      );
      const executor = opts.executorName?.trim();
      if (!executor) {
        throw new BadRequestException('Indiquez le livreur pour cette ligne.');
      }
    } else {
      const dept = await tx.department.findFirst({
        where: { id: departmentId, companyId: opts.delivery.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('Département introuvable');
      if (!canAccessAssignedDepartment(opts.user, dept.id)) {
        throw new ForbiddenException('Département hors périmètre');
      }
    }

    let stopId = opts.stopId ?? null;
    if (isHome) {
      if (stopId == null) {
        const first = await tx.saleDeliveryStop.findFirst({
          where: { saleId: opts.delivery.sale.id },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        stopId = first?.id ?? null;
      } else {
        const stop = await tx.saleDeliveryStop.findFirst({
          where: { id: stopId, saleId: opts.delivery.sale.id },
          select: { id: true },
        });
        if (!stop) throw new BadRequestException('Adresse de dépôt introuvable');
      }
    } else {
      stopId = null;
    }

    await tx.deliveryDrop.create({
      data: {
        deliveryId: opts.delivery.id,
        saleItemId: opts.saleItemId,
        quantity: qty,
        departmentId,
        executorName: opts.executorName?.trim() || null,
        deliveredById: opts.user.id ?? null,
        createdById: opts.user.id ?? null,
        stopId,
      },
    });

    const nextDelivered = Number(item.quantityDelivered) + qty;
    await tx.deliveryItem.updateMany({
      where: { deliveryId: opts.delivery.id, saleItemId: opts.saleItemId },
      data: { quantityDelivered: nextDelivered },
    });
    item.quantityDelivered = nextDelivered as unknown as Prisma.Decimal;

    await this.applyStockDeltaForDeliveryItem(tx, {
      saleId: opts.delivery.sale.id,
      saleItemId: opts.saleItemId,
      deltaSaleQty: qty,
      userId: opts.user.id,
      fulfillmentType: opts.delivery.fulfillmentType,
      stockDepartmentId: departmentId,
    });
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
      fulfillmentType: FulfillmentType;
      stockDepartmentId?: number | null;
    },
  ) {
    const saleItem = await tx.saleItem.findUnique({
      where: { id: opts.saleItemId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            companyId: true,
            departmentId: true,
            trackStock: true,
            isService: true,
          },
        },
      },
    });
    if (!saleItem) return;

    const saleQty = Number(saleItem.quantity);
    const baseFull = Number(saleItem.baseQuantity);
    if (saleQty <= 0) return;
    const baseDelta = (opts.deltaSaleQty / saleQty) * baseFull;
    if (Math.abs(baseDelta) <= 0.0001) return;

    const product = saleItem.product;
    const remapDept =
      opts.fulfillmentType === FulfillmentType.HOME ? opts.stockDepartmentId ?? null : null;
    if (opts.fulfillmentType === FulfillmentType.HOME && remapDept == null) {
      throw new BadRequestException(
        'Choisissez le département depuis lequel la livraison à domicile est faite.',
      );
    }

    const stockProductId =
      remapDept != null
        ? await this.resolveProductInDepartment(tx, product, remapDept)
        : product.id;

    const reason =
      baseDelta > 0
        ? `Livraison vente #${opts.saleId}`
        : `Correction livraison #${opts.saleId}`;

    if (product.isService) {
      const recipe = await tx.productRecipe.findUnique({
        where: { parentProductId: product.id },
        include: {
          components: {
            include: {
              componentProduct: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  companyId: true,
                  departmentId: true,
                },
              },
            },
          },
        },
      });
      if (!recipe?.components.length) return;
      for (const c of recipe.components) {
        const need = Number(c.quantityPerParentBaseUnit) * baseDelta;
        if (Math.abs(need) <= 0.0001) continue;
        const componentId =
          remapDept != null
            ? await this.resolveProductInDepartment(tx, c.componentProduct, remapDept)
            : c.componentProductId;
        if (need > 0) {
          await this.inventoryService.ensureStockAvailabilityTx(tx, componentId, need);
          await this.inventoryService.decrementStockTx(
            tx,
            componentId,
            need,
            opts.userId,
            `${reason} — ${product.name}`,
          );
        } else {
          await tx.product.update({
            where: { id: componentId },
            data: { stock: { increment: Math.abs(need) } },
          });
          await tx.stockMovement.create({
            data: {
              productId: componentId,
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
      await this.inventoryService.ensureStockAvailabilityTx(tx, stockProductId, baseDelta);
      await this.inventoryService.decrementStockTx(
        tx,
        stockProductId,
        baseDelta,
        opts.userId,
        reason,
      );
    } else {
      await tx.product.update({
        where: { id: stockProductId },
        data: { stock: { increment: Math.abs(baseDelta) } },
      });
      await tx.stockMovement.create({
        data: {
          productId: stockProductId,
          quantity: Math.abs(baseDelta),
          type: MovementType.IN,
          reason,
          createdById: opts.userId,
        },
      });
    }
  }

  private departmentListClause(scope: {
    departmentId?: number;
    departmentIds?: number[];
  }): Prisma.DeliveryWhereInput {
    const homePending: Prisma.DeliveryWhereInput = {
      fulfillmentType: FulfillmentType.HOME,
      departmentId: null,
    };
    if (scope.departmentId != null) {
      return { OR: [{ departmentId: scope.departmentId }, homePending] };
    }
    if (scope.departmentIds?.length) {
      return {
        OR: [{ departmentId: { in: scope.departmentIds } }, homePending],
      };
    }
    return {};
  }

  private async assertHomeStockDepartment(
    departmentId: number,
    companyId: number,
    user: ScopeUser,
  ): Promise<number> {
    const dept = await this.prisma.department.findFirst({
      where: { id: departmentId, companyId, deletedAt: null },
      select: { id: true, name: true, offersHomeDelivery: true },
    });
    if (!dept) {
      throw new BadRequestException('Département introuvable');
    }
    if (!dept.offersHomeDelivery) {
      throw new BadRequestException(
        `Le département « ${dept.name} » n’est pas configuré pour les livraisons à domicile.`,
      );
    }
    if (!canAccessAssignedDepartment(user, dept.id)) {
      throw new ForbiddenException('Département hors périmètre');
    }
    return dept.id;
  }

  private async resolveProductInDepartment(
    tx: Prisma.TransactionClient,
    source: {
      id: number;
      name: string;
      sku: string | null;
      companyId: number;
      departmentId: number | null;
    },
    targetDepartmentId: number,
  ): Promise<number> {
    if (source.departmentId === targetDepartmentId) return source.id;
    const sku = source.sku?.trim();
    if (sku) {
      const bySku = await tx.product.findFirst({
        where: {
          companyId: source.companyId,
          departmentId: targetDepartmentId,
          sku,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (bySku) return bySku.id;
    }
    const byName = await tx.product.findFirst({
      where: {
        companyId: source.companyId,
        departmentId: targetDepartmentId,
        name: source.name,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (byName) return byName.id;
    throw new BadRequestException(
      `Le produit « ${source.name} » n’existe pas dans le département choisi pour la livraison. Créez-le dans ce département avant de livrer.`,
    );
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
  ): { companyId?: number; departmentId?: number; departmentIds?: number[] } {
    const role = user.role ?? '';
    if (role === 'ADMIN') {
      return {
        companyId: filters.companyId,
        departmentId: filters.departmentId,
      };
    }

    if (user.companyId == null) {
      throw new ForbiddenException('Affectation entreprise manquante');
    }
    const companyId = filters.companyId ?? user.companyId;
    if (companyId !== user.companyId) {
      throw new ForbiddenException('Entreprise hors périmètre');
    }
    const allowed = resolvedDepartmentIds(user);
    if (filters.departmentId != null) {
      if (allowed.length && !allowed.includes(filters.departmentId)) {
        throw new ForbiddenException('Département hors périmètre');
      }
      return { companyId, departmentId: filters.departmentId };
    }
    return {
      companyId,
      departmentIds: allowed.length ? allowed : undefined,
    };
  }

  private assertCanAccess(
    user: ScopeUser,
    companyId: number,
    departmentId: number | null,
  ) {
    const role = user.role ?? '';
    if (role === 'ADMIN') return;

    if (user.companyId != null && user.companyId !== companyId) {
      throw new ForbiddenException('Accès refusé');
    }
    if (!canAccessAssignedDepartment(user, departmentId)) {
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

  private parseFulfillmentType(raw?: string): FulfillmentType | undefined {
    if (!raw?.trim()) return undefined;
    const v = raw.trim().toUpperCase();
    if (v === 'ON_SITE' || v === 'HOME') {
      return v as FulfillmentType;
    }
    throw new BadRequestException('Type de remise invalide');
  }

  private async assertCanManageFulfillment(user: ScopeUser, fulfillmentType: FulfillmentType) {
    const role = user.role ?? '';
    const perms = role ? await this.rolesService.getPermissionsForUserRole(role) : [];
    if (role === 'ADMIN' && (!perms.length || perms.includes('*'))) return;
    if (!canManageDeliveryFulfillment(perms, fulfillmentType)) {
      throw new ForbiddenException(
        fulfillmentType === FulfillmentType.HOME
          ? 'Ce rôle ne peut pas gérer les livraisons à domicile.'
          : 'Ce rôle ne peut pas gérer les livraisons sur place.',
      );
    }
  }
}
