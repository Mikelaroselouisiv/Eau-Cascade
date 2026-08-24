import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GoodsReceiptStatus,
  MovementType,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateGoodsReceiptDto,
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
} from './dto/purchasing.dto';

export type ReceptionStatus = 'pending' | 'partial' | 'complete';

type PoLineProgress = {
  productId: number;
  quantityOrdered: number;
  quantityReceived: number;
  quantityRemaining: number;
};

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private sumReceivedByProduct(
    receipts: Array<{ lines: Array<{ productId: number; quantity: Prisma.Decimal }> }>,
  ): Map<number, number> {
    const map = new Map<number, number>();
    for (const gr of receipts) {
      for (const line of gr.lines) {
        const prev = map.get(line.productId) ?? 0;
        map.set(line.productId, prev + Number(line.quantity));
      }
    }
    return map;
  }

  private buildLineProgress(
    poLines: Array<{ productId: number; quantityOrdered: Prisma.Decimal }>,
    receivedByProduct: Map<number, number>,
  ): PoLineProgress[] {
    return poLines.map((l) => {
      const ordered = Number(l.quantityOrdered);
      const received = receivedByProduct.get(l.productId) ?? 0;
      const remaining = Math.max(0, ordered - received);
      return {
        productId: l.productId,
        quantityOrdered: ordered,
        quantityReceived: received,
        quantityRemaining: remaining,
      };
    });
  }

  private receptionStatusFromProgress(progress: PoLineProgress[]): ReceptionStatus {
    if (progress.length === 0) return 'pending';
    const totalOrdered = progress.reduce((s, l) => s + l.quantityOrdered, 0);
    const totalReceived = progress.reduce((s, l) => s + l.quantityReceived, 0);
    if (totalReceived <= 0) return 'pending';
    if (progress.every((l) => l.quantityReceived >= l.quantityOrdered)) return 'complete';
    if (totalReceived < totalOrdered) return 'partial';
    return 'complete';
  }

  private enrichPurchaseOrder<
    T extends {
      status: PurchaseOrderStatus;
      lines: Array<{
        productId: number;
        quantityOrdered: Prisma.Decimal;
        unitPriceEst?: Prisma.Decimal | null;
      }>;
      goodsReceipts: Array<{
        lines: Array<{
          productId: number;
          quantity: Prisma.Decimal;
          unitCost?: Prisma.Decimal | null;
        }>;
      }>;
    },
  >(po: T) {
    const posted = po.goodsReceipts ?? [];
    const receivedByProduct = this.sumReceivedByProduct(posted);
    const lineProgress = this.buildLineProgress(po.lines, receivedByProduct);
    const receptionStatus =
      po.status === PurchaseOrderStatus.CLOSED
        ? ('complete' as ReceptionStatus)
        : this.receptionStatusFromProgress(lineProgress);

    let amountOrderedEst = 0;
    let orderedLinesMissingPrice = 0;
    for (const line of po.lines) {
      const qty = Number(line.quantityOrdered);
      const price = line.unitPriceEst != null ? Number(line.unitPriceEst) : null;
      if (price == null || !Number.isFinite(price)) {
        orderedLinesMissingPrice += 1;
        continue;
      }
      amountOrderedEst += qty * price;
    }

    let amountReceived = 0;
    for (const gr of posted) {
      for (const line of gr.lines) {
        const qty = Number(line.quantity);
        const cost = line.unitCost != null ? Number(line.unitCost) : 0;
        if (Number.isFinite(qty) && Number.isFinite(cost)) {
          amountReceived += qty * cost;
        }
      }
    }

    let amountPendingEst = 0;
    for (const prog of lineProgress) {
      if (prog.quantityRemaining <= 0) continue;
      const line = po.lines.find((l) => l.productId === prog.productId);
      const price = line?.unitPriceEst != null ? Number(line.unitPriceEst) : null;
      if (price == null || !Number.isFinite(price)) continue;
      amountPendingEst += prog.quantityRemaining * price;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      ...po,
      receptionStatus,
      lineProgress,
      amountOrderedEst: round2(amountOrderedEst),
      amountReceived: round2(amountReceived),
      amountPendingEst: round2(amountPendingEst),
      orderedLinesMissingPrice,
    };
  }

  listPurchaseOrders(companyId?: number) {
    return this.prisma.purchaseOrder
      .findMany({
        where: {
          deletedAt: null,
          ...(companyId ? { companyId } : {}),
        },
        include: {
          department: { select: { id: true, name: true } },
          createdBy: { select: USER_ATTRIBUTION_SELECT },
          lines: { select: { productId: true, quantityOrdered: true, unitPriceEst: true } },
          goodsReceipts: {
            where: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
            select: {
              lines: { select: { productId: true, quantity: true, unitCost: true } },
            },
          },
          _count: { select: { lines: true, goodsReceipts: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      .then((rows) => rows.map((po) => this.enrichPurchaseOrder(po)));
  }

  /**
   * Totaux estimés des commandes (qty × prix unitaire) — suivi opérationnel admin.
   * N’impacte pas la caisse / le journal : seuls les achats reçus y sont enregistrés.
   */
  async getPurchaseOrdersAmountSummary(companyId: number) {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        deletedAt: null,
        companyId,
        status: { not: PurchaseOrderStatus.CANCELLED },
      },
      include: {
        lines: { select: { productId: true, quantityOrdered: true, unitPriceEst: true } },
        goodsReceipts: {
          where: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
          select: {
            lines: { select: { productId: true, quantity: true, unitCost: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = rows.map((po) => this.enrichPurchaseOrder(po));
    const round2 = (n: number) => Math.round(n * 100) / 100;

    let amountOrderedEst = 0;
    let amountReceived = 0;
    let amountPendingEst = 0;
    let ordersMissingPrice = 0;
    let pendingCount = 0;
    let partialCount = 0;
    let completeCount = 0;

    for (const po of enriched) {
      amountOrderedEst += po.amountOrderedEst;
      amountReceived += po.amountReceived;
      amountPendingEst += po.amountPendingEst;
      if (po.orderedLinesMissingPrice > 0) ordersMissingPrice += 1;
      if (po.receptionStatus === 'pending') pendingCount += 1;
      else if (po.receptionStatus === 'partial') partialCount += 1;
      else completeCount += 1;
    }

    return {
      companyId,
      orderCount: enriched.length,
      pendingCount,
      partialCount,
      completeCount,
      ordersMissingPrice,
      amountOrderedEst: round2(amountOrderedEst),
      amountReceived: round2(amountReceived),
      amountPendingEst: round2(amountPendingEst),
    };
  }

  async getPurchaseOrder(id: number) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        department: true,
        createdBy: { select: USER_ATTRIBUTION_SELECT },
        lines: { include: { product: true } },
        goodsReceipts: {
          where: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
          orderBy: { receivedAt: 'asc' },
          include: {
            lines: { include: { product: true } },
            createdBy: { select: USER_ATTRIBUTION_SELECT },
          },
        },
      },
    });
    if (!po) {
      throw new NotFoundException('Bon de commande introuvable');
    }
    const enriched = this.enrichPurchaseOrder(po);
    return {
      ...enriched,
      lines: enriched.lines.map((line) => {
        const prog = enriched.lineProgress.find((p) => p.productId === line.productId);
        return {
          ...line,
          quantityOrdered: Number(line.quantityOrdered),
          quantityReceived: prog?.quantityReceived ?? 0,
          quantityRemaining: prog?.quantityRemaining ?? Number(line.quantityOrdered),
          unitPriceEst: line.unitPriceEst != null ? Number(line.unitPriceEst) : null,
        };
      }),
    };
  }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto, createdById?: number) {
    const dept = await this.prisma.department.findUnique({
      where: { id: dto.departmentId },
    });
    if (!dept || dept.companyId !== dto.companyId) {
      throw new BadRequestException('Département invalide pour cette entreprise');
    }
    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId: dto.companyId },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('Un ou plusieurs produits sont invalides');
    }
    for (const p of products) {
      if (p.departmentId !== dto.departmentId) {
        throw new BadRequestException(
          `Le produit « ${p.name} » doit appartenir au même département que le bon.`,
        );
      }
    }

    const po = await this.prisma.purchaseOrder.create({
      data: {
        companyId: dto.companyId,
        departmentId: dto.departmentId,
        supplierName: dto.supplierName ?? null,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
        createdById: createdById ?? null,
        status: PurchaseOrderStatus.ORDERED,
        lines: {
          create: dto.lines.map((l) => ({
            productId: l.productId,
            quantityOrdered: l.quantityOrdered,
            unitPriceEst: l.unitPriceEst ?? null,
          })),
        },
      },
      include: {
        lines: { include: { product: true } },
        department: true,
        createdBy: { select: USER_ATTRIBUTION_SELECT },
        goodsReceipts: {
          where: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
          select: { lines: { select: { productId: true, quantity: true } } },
        },
      },
    });
    await this.auditService.log({
      userId: createdById,
      action: 'PURCHASE_ORDER_CREATED',
      entity: 'PurchaseOrder',
      entityId: String(po.id),
    });
    return this.enrichPurchaseOrder(po);
  }

  listGoodsReceipts(departmentId?: number) {
    return this.prisma.goodsReceipt.findMany({
      where: {
        deletedAt: null,
        departmentId: departmentId ?? undefined,
        purchaseOrderId: { not: null },
      },
      include: {
        department: { select: { id: true, name: true, companyId: true } },
        createdBy: { select: USER_ATTRIBUTION_SELECT },
        _count: { select: { lines: true } },
        purchaseOrder: { select: { id: true, reference: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getGoodsReceipt(id: number) {
    const gr = await this.prisma.goodsReceipt.findFirst({
      where: { id, deletedAt: null },
      include: {
        department: { include: { company: true } },
        createdBy: { select: USER_ATTRIBUTION_SELECT },
        lines: { include: { product: true } },
        purchaseOrder: true,
      },
    });
    if (!gr) {
      throw new NotFoundException('Réception introuvable');
    }
    return gr;
  }

  async receivePurchaseOrder(
    purchaseOrderId: number,
    dto: ReceivePurchaseOrderDto,
    createdById?: number,
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, deletedAt: null },
      include: {
        lines: true,
        goodsReceipts: {
          where: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
          include: { lines: true },
        },
      },
    });
    if (!po) {
      throw new NotFoundException('Bon de commande introuvable');
    }
    if (po.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Commande annulée.');
    }
    if (po.status === PurchaseOrderStatus.CLOSED) {
      throw new BadRequestException('Réception déjà complète.');
    }

    const receivedByProduct = this.sumReceivedByProduct(po.goodsReceipts);
    const progress = this.buildLineProgress(po.lines, receivedByProduct);
    const poProductIds = new Set(po.lines.map((l) => l.productId));

    const activeLines = dto.lines.filter((l) => l.quantity > 0);
    if (activeLines.length === 0) {
      throw new BadRequestException('Quantité requise.');
    }

    for (const line of activeLines) {
      if (!poProductIds.has(line.productId)) {
        throw new BadRequestException('Produit hors commande.');
      }
      const prog = progress.find((p) => p.productId === line.productId);
      if (!prog || prog.quantityRemaining <= 0) {
        throw new BadRequestException('Ligne déjà complète.');
      }
      if (line.quantity > prog.quantityRemaining + 1e-9) {
        throw new BadRequestException('Quantité supérieure au reste à recevoir.');
      }
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: activeLines.map((l) => l.productId) } },
    });
    for (const p of products) {
      if (p.departmentId !== po.departmentId) {
        throw new BadRequestException(`Produit ${p.name} : mauvais département`);
      }
      if (!p.trackStock) {
        throw new BadRequestException(`Produit ${p.name} : stock non suivi`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const costByProduct = new Map<number, number>();
      for (const line of po.lines) {
        if (line.unitPriceEst != null) {
          costByProduct.set(line.productId, Number(line.unitPriceEst));
        }
      }
      for (const p of products) {
        if (!costByProduct.has(p.id)) {
          costByProduct.set(p.id, Number(p.cost));
        }
      }

      const gr = await tx.goodsReceipt.create({
        data: {
          departmentId: po.departmentId,
          purchaseOrderId: po.id,
          note: dto.note ?? null,
          createdById: createdById ?? null,
          status: GoodsReceiptStatus.DRAFT,
          lines: {
            create: activeLines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitCost:
                l.unitCost != null && Number.isFinite(Number(l.unitCost))
                  ? Number(l.unitCost)
                  : (costByProduct.get(l.productId) ?? 0),
            })),
          },
        },
        include: { lines: true },
      });

      await this.postGoodsReceiptTx(tx, gr.id, createdById);

      const updatedPo = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        include: {
          lines: true,
          goodsReceipts: {
            where: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
            include: { lines: true },
          },
        },
      });

      const newProgress = this.buildLineProgress(
        updatedPo.lines,
        this.sumReceivedByProduct(updatedPo.goodsReceipts),
      );
      const fullyReceived = newProgress.every(
        (l) => l.quantityReceived >= l.quantityOrdered,
      );
      if (fullyReceived) {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: PurchaseOrderStatus.CLOSED },
        });
      }

      await this.auditService.log({
        userId: createdById,
        action: 'GOODS_RECEIPT_POSTED',
        entity: 'GoodsReceipt',
        entityId: String(gr.id),
        metadata: { purchaseOrderId: po.id, complete: fullyReceived },
      });

      return this.getPurchaseOrder(po.id);
    });
  }

  async createGoodsReceipt(dto: CreateGoodsReceiptDto, createdById?: number) {
    return this.receivePurchaseOrder(
      dto.purchaseOrderId,
      { note: dto.note, lines: dto.lines },
      createdById,
    );
  }

  private async postGoodsReceiptTx(
    tx: Prisma.TransactionClient,
    id: number,
    userId?: number,
  ) {
    const gr = await tx.goodsReceipt.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!gr) {
      throw new NotFoundException('Réception introuvable');
    }
    if (gr.status !== GoodsReceiptStatus.DRAFT) {
      throw new BadRequestException('Cette réception est déjà postée.');
    }

    for (const line of gr.lines) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (!product) {
        throw new BadRequestException(`Produit ${line.productId} introuvable`);
      }
      if (!product.trackStock) {
        throw new BadRequestException(`Produit ${product.name} : stock non suivi`);
      }
      if (product.departmentId !== gr.departmentId) {
        throw new BadRequestException(`Produit ${product.name} : mauvais département`);
      }

      const inQty = Number(line.quantity);
      const inCost = Number(line.unitCost);
      const oldStock = Number(product.stock);
      const oldCost = Number(product.cost);
      const newStock = oldStock + inQty;
      const newCost =
        newStock > 0 ? (oldStock * oldCost + inQty * inCost) / newStock : inCost;

      await tx.product.update({
        where: { id: product.id },
        data: {
          stock: { increment: inQty },
          cost: newCost,
        },
      });
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          quantity: inQty,
          type: MovementType.IN,
          reason: `Réception achat #${gr.id}`,
          createdById: userId,
          goodsReceiptId: gr.id,
        },
      });
    }

    await tx.goodsReceipt.update({
      where: { id: gr.id },
      data: { status: GoodsReceiptStatus.POSTED },
    });
  }

  /** Poste la réception : entrées stock + coût moyen pondéré. */
  async postGoodsReceipt(id: number, userId?: number) {
    const gr = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      include: { lines: true, purchaseOrder: true },
    });
    if (!gr) {
      throw new NotFoundException('Réception introuvable');
    }
    if (!gr.purchaseOrderId) {
      throw new BadRequestException('Réception sans commande.');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.postGoodsReceiptTx(tx, id, userId);

      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: gr.purchaseOrderId! },
        include: {
          lines: true,
          goodsReceipts: {
            where: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
            include: { lines: true },
          },
        },
      });
      const progress = this.buildLineProgress(
        po.lines,
        this.sumReceivedByProduct(po.goodsReceipts),
      );
      if (progress.every((l) => l.quantityReceived >= l.quantityOrdered)) {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: PurchaseOrderStatus.CLOSED },
        });
      }

      const amount = gr.lines.reduce(
        (s, l) => s + Number(l.quantity) * Number(l.unitCost),
        0,
      );
      await this.accountingPosting.postPurchaseReceipt(
        {
          companyId: po.companyId,
          goodsReceiptId: id,
          entryDate: gr.receivedAt ?? new Date(),
          amount,
          supplierName: po.supplierName,
          createdById: userId,
        },
        tx,
      );
    });

    const posted = await this.getGoodsReceipt(id);
    await this.auditService.log({
      userId,
      action: 'GOODS_RECEIPT_POSTED',
      entity: 'GoodsReceipt',
      entityId: String(id),
    });
    return posted;
  }

  async deletePurchaseOrder(id: number, userId?: number) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        goodsReceipts: {
          where: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
          select: { id: true },
        },
      },
    });
    if (!po) {
      throw new NotFoundException('Bon de commande introuvable');
    }
    if (po.goodsReceipts.length > 0) {
      throw new BadRequestException('Impossible : réceptions déjà enregistrées.');
    }

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditService.log({
      userId,
      action: 'PURCHASE_ORDER_DELETED',
      entity: 'PurchaseOrder',
      entityId: String(id),
    });
  }

  async deleteGoodsReceipt(id: number, userId?: number) {
    const gr = await this.prisma.goodsReceipt.findFirst({
      where: { id, deletedAt: null },
      include: {
        lines: true,
        purchaseOrder: {
          include: {
            lines: true,
            goodsReceipts: {
              where: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
              include: { lines: true },
            },
          },
        },
      },
    });
    if (!gr) {
      throw new NotFoundException('Réception introuvable');
    }
    if (gr.status !== GoodsReceiptStatus.POSTED) {
      throw new BadRequestException('Seules les réceptions validées peuvent être supprimées.');
    }
    if (!gr.purchaseOrderId || !gr.purchaseOrder) {
      throw new BadRequestException('Réception sans commande.');
    }

    const po = gr.purchaseOrder;
    const poId = gr.purchaseOrderId;

    await this.prisma.$transaction(async (tx) => {
      for (const line of gr.lines) {
        const product = await tx.product.findUnique({ where: { id: line.productId } });
        if (!product) {
          throw new BadRequestException(`Produit ${line.productId} introuvable`);
        }
        const outQty = Number(line.quantity);
        const inCost = Number(line.unitCost);
        const currentStock = Number(product.stock);
        const currentCost = Number(product.cost);

        if (currentStock + 1e-9 < outQty) {
          throw new BadRequestException(
            `Stock insuffisant pour « ${product.name} » (${currentStock} disponible).`,
          );
        }

        const newStock = currentStock - outQty;
        let newCost = currentCost;
        if (newStock > 1e-9) {
          newCost = (currentStock * currentCost - outQty * inCost) / newStock;
        }

        await tx.product.update({
          where: { id: product.id },
          data: { stock: newStock, cost: newCost },
        });
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            quantity: outQty,
            type: MovementType.OUT,
            reason: `Annulation réception achat #${gr.id}`,
            createdById: userId,
          },
        });
      }

      await tx.goodsReceipt.update({
        where: { id: gr.id },
        data: { deletedAt: new Date() },
      });

      const remainingReceipts = po.goodsReceipts.filter((r) => r.id !== gr.id);
      const newProgress = this.buildLineProgress(
        po.lines,
        this.sumReceivedByProduct(remainingReceipts),
      );
      const fullyReceived = newProgress.every(
        (l) => l.quantityReceived >= l.quantityOrdered,
      );

      if (po.status === PurchaseOrderStatus.CLOSED && !fullyReceived) {
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: { status: PurchaseOrderStatus.ORDERED },
        });
      }
    });

    await this.auditService.log({
      userId,
      action: 'GOODS_RECEIPT_DELETED',
      entity: 'GoodsReceipt',
      entityId: String(id),
      metadata: { purchaseOrderId: poId },
    });

    return this.getPurchaseOrder(poId);
  }
}
