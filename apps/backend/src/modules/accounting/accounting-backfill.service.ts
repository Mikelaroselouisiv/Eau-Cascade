import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  FinanceType,
  GoodsReceiptStatus,
  PaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingPostingService } from './accounting-posting.service';
import { AccountingService } from './accounting.service';

export type BackfillResult = {
  fiscalYear: { id: number; label: string; startDate: string; endDate: string };
  posted: {
    sales: number;
    creditSales: number;
    creditPayments: number;
    expenses: number;
    purchases: number;
    bankManual: number;
    supplierPayments: number;
    fixedAssets: number;
    depreciations: number;
  };
  skipped: {
    outsidePeriod: number;
    alreadyPosted: number;
    other: number;
  };
};

@Injectable()
export class AccountingBackfillService {
  private readonly logger = new Logger(AccountingBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: AccountingPostingService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private inRange(d: Date, from: Date, to: Date): boolean {
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    return day >= from && day <= to;
  }

  private async alreadyPosted(companyId: number, source: string, sourceId: string) {
    const row = await this.prisma.journalEntry.findFirst({
      where: {
        companyId,
        source,
        sourceId,
        deletedAt: null,
        status: 'POSTED',
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  /**
   * Rejoue les opérations métier de l’exercice ouvert en écritures comptables (idempotent).
   */
  async backfill(companyId: number, userId?: number): Promise<BackfillResult> {
    await this.accounting.ensureChartOfAccounts(companyId);
    const fy = await this.accounting.getOpenFiscalYear(companyId);
    if (!fy) {
      throw new BadRequestException(
        'Ouvrez un exercice comptable avant la reprise historique.',
      );
    }

    const from = fy.startDate;
    const to = fy.endDate;
    const result: BackfillResult = {
      fiscalYear: {
        id: fy.id,
        label: fy.label,
        startDate: from.toISOString().slice(0, 10),
        endDate: to.toISOString().slice(0, 10),
      },
      posted: {
        sales: 0,
        creditSales: 0,
        creditPayments: 0,
        expenses: 0,
        purchases: 0,
        bankManual: 0,
        supplierPayments: 0,
        fixedAssets: 0,
        depreciations: 0,
      },
      skipped: { outsidePeriod: 0, alreadyPosted: 0, other: 0 },
    };

    // ——— Ventes POS (hors crédit) ———
    const sales = await this.prisma.sale.findMany({
      where: {
        deletedAt: null,
        status: 'COMPLETED',
        creditCustomerId: null,
        createdAt: { gte: from, lte: new Date(to.getTime() + 24 * 3600 * 1000 - 1) },
        items: { some: { product: { companyId } } },
      },
      include: {
        payments: { where: { deletedAt: null } },
        items: { select: { baseQuantity: true, product: { select: { cost: true, companyId: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const sale of sales) {
      if (!this.inRange(sale.createdAt, from, to)) {
        result.skipped.outsidePeriod += 1;
        continue;
      }
      if (await this.alreadyPosted(companyId, 'SALE', String(sale.id))) {
        result.skipped.alreadyPosted += 1;
        continue;
      }
      const total = this.round2(Number(sale.total));
      const cashAmount = sale.payments
        .filter((p) => p.method !== PaymentMethod.CREDIT && p.method !== PaymentMethod.BANK)
        .reduce((s, p) => s + Number(p.amount), 0);
      const bankAmount = sale.payments
        .filter((p) => p.method === PaymentMethod.BANK)
        .reduce((s, p) => s + Number(p.amount), 0);
      const cogs = sale.items.reduce(
        (s, it) => s + Number(it.baseQuantity) * Number(it.product.cost ?? 0),
        0,
      );
      try {
        await this.posting.postPosSale({
          companyId,
          saleId: sale.id,
          entryDate: sale.createdAt,
          total,
          cashAmount,
          bankAmount,
          cogs,
          createdById: sale.userId,
          txnLabel: `#${sale.txnNumber ?? sale.id}`,
        });
        result.posted.sales += 1;
      } catch {
        result.skipped.other += 1;
      }
    }

    // ——— Ventes crédit ———
    const creditSales = await this.prisma.sale.findMany({
      where: {
        deletedAt: null,
        status: 'COMPLETED',
        creditCustomerId: { not: null },
        createdAt: { gte: from, lte: new Date(to.getTime() + 24 * 3600 * 1000 - 1) },
        creditCustomer: { companyId },
      },
      include: {
        creditCustomer: { select: { name: true, companyId: true } },
        items: { select: { baseQuantity: true, product: { select: { cost: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const sale of creditSales) {
      if (!this.inRange(sale.createdAt, from, to)) {
        result.skipped.outsidePeriod += 1;
        continue;
      }
      if (await this.alreadyPosted(companyId, 'CREDIT_SALE', String(sale.id))) {
        result.skipped.alreadyPosted += 1;
        continue;
      }
      const total = this.round2(Number(sale.total));
      const cogs = sale.items.reduce(
        (s, it) => s + Number(it.baseQuantity) * Number(it.product.cost ?? 0),
        0,
      );
      try {
        // Acomptes / remboursements rejoués via CreditPayment (évite double CREDIT_DOWN).
        await this.posting.postCreditSale({
          companyId,
          saleId: sale.id,
          entryDate: sale.createdAt,
          total,
          downPayment: 0,
          cogs,
          customerName: sale.creditCustomer?.name,
          createdById: sale.userId,
        });
        result.posted.creditSales += 1;
      } catch {
        result.skipped.other += 1;
      }
    }

    // ——— Encaissements crédit (y compris acomptes) ———
    const creditPayments = await this.prisma.creditPayment.findMany({
      where: {
        deletedAt: null,
        createdAt: { gte: from, lte: new Date(to.getTime() + 24 * 3600 * 1000 - 1) },
        creditCustomer: { companyId },
      },
      include: { creditCustomer: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    for (const cp of creditPayments) {
      if (!this.inRange(cp.createdAt, from, to)) {
        result.skipped.outsidePeriod += 1;
        continue;
      }
      if (await this.alreadyPosted(companyId, 'CREDIT_PAYMENT', String(cp.id))) {
        result.skipped.alreadyPosted += 1;
        continue;
      }
      // Si l’acompte a déjà été posté en CREDIT_DOWN (flux live), ne pas doubler.
      if (
        cp.note === 'Acompte à l’achat' &&
        cp.saleId != null &&
        (await this.alreadyPosted(companyId, 'CREDIT_DOWN', String(cp.saleId)))
      ) {
        result.skipped.alreadyPosted += 1;
        continue;
      }
      try {
        await this.posting.postCreditPayment({
          companyId,
          paymentId: cp.id,
          entryDate: cp.createdAt,
          amount: Number(cp.amount),
          method: cp.method,
          customerName: cp.creditCustomer.name,
          createdById: cp.userId,
        });
        result.posted.creditPayments += 1;
      } catch {
        result.skipped.other += 1;
      }
    }

    // ——— Dépenses manuelles ———
    const expenses = await this.prisma.financeEntry.findMany({
      where: {
        deletedAt: null,
        type: FinanceType.EXPENSE,
        createdAt: { gte: from, lte: new Date(to.getTime() + 24 * 3600 * 1000 - 1) },
        OR: [
          { category: { companyId } },
          { categoryId: null, user: { companyId } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const fe of expenses) {
      if (!this.inRange(fe.createdAt, from, to)) {
        result.skipped.outsidePeriod += 1;
        continue;
      }
      if (await this.alreadyPosted(companyId, 'EXPENSE', String(fe.id))) {
        result.skipped.alreadyPosted += 1;
        continue;
      }
      try {
        await this.posting.postExpense({
          companyId,
          financeEntryId: fe.id,
          entryDate: fe.createdAt,
          amount: Number(fe.amount),
          description: fe.description,
          createdById: fe.userId,
        });
        result.posted.expenses += 1;
      } catch {
        result.skipped.other += 1;
      }
    }

    // ——— Achats (réceptions postées) ———
    const receipts = await this.prisma.goodsReceipt.findMany({
      where: {
        deletedAt: null,
        status: GoodsReceiptStatus.POSTED,
        receivedAt: { gte: from, lte: new Date(to.getTime() + 24 * 3600 * 1000 - 1) },
        purchaseOrder: { companyId },
      },
      include: {
        lines: true,
        purchaseOrder: { select: { companyId: true, supplierName: true } },
      },
      orderBy: { receivedAt: 'asc' },
    });

    for (const gr of receipts) {
      if (!this.inRange(gr.receivedAt, from, to)) {
        result.skipped.outsidePeriod += 1;
        continue;
      }
      if (await this.alreadyPosted(companyId, 'PURCHASE', String(gr.id))) {
        result.skipped.alreadyPosted += 1;
        continue;
      }
      const amount = gr.lines.reduce(
        (s, l) => s + Number(l.quantity) * Number(l.unitCost),
        0,
      );
      try {
        await this.posting.postPurchaseReceipt({
          companyId,
          goodsReceiptId: gr.id,
          entryDate: gr.receivedAt,
          amount,
          supplierName: gr.purchaseOrder?.supplierName,
          createdById: gr.createdById,
        });
        result.posted.purchases += 1;
      } catch {
        result.skipped.other += 1;
      }
    }

    // ——— Banques manuelles (hors dépôts auto vente/crédit) ———
    const bankTx = await this.prisma.bankTransaction.findMany({
      where: {
        deletedAt: null,
        occurredAt: { gte: from, lte: new Date(to.getTime() + 24 * 3600 * 1000 - 1) },
        bankAccount: { companyId },
      },
      orderBy: { occurredAt: 'asc' },
    });

    for (const tx of bankTx) {
      const ref = tx.reference?.trim() ?? '';
      if (
        ref.startsWith('saleTxn:') ||
        ref.startsWith('creditPayment:') ||
        ref.startsWith('supplierPayment:') ||
        ref.startsWith('fixedAsset:')
      ) {
        result.skipped.other += 1;
        continue;
      }
      if (!this.inRange(tx.occurredAt, from, to)) {
        result.skipped.outsidePeriod += 1;
        continue;
      }
      if (await this.alreadyPosted(companyId, 'BANK', String(tx.id))) {
        result.skipped.alreadyPosted += 1;
        continue;
      }
      try {
        await this.posting.postBankTransaction({
          companyId,
          transactionId: tx.id,
          entryDate: tx.occurredAt,
          amount: Number(tx.amount),
          type: tx.type,
          description: tx.description,
          createdById: tx.userId,
        });
        result.posted.bankManual += 1;
      } catch {
        result.skipped.other += 1;
      }
    }

    // ——— Paiements fournisseurs déjà enregistrés ———
    const supplierPays = await this.prisma.supplierPayment.findMany({
      where: {
        deletedAt: null,
        companyId,
        paidAt: { gte: from, lte: new Date(to.getTime() + 24 * 3600 * 1000 - 1) },
      },
      orderBy: { paidAt: 'asc' },
    });
    for (const sp of supplierPays) {
      if (await this.alreadyPosted(companyId, 'SUPPLIER_PAYMENT', String(sp.id))) {
        result.skipped.alreadyPosted += 1;
        continue;
      }
      try {
        await this.posting.postSupplierPayment({
          companyId,
          paymentId: sp.id,
          entryDate: sp.paidAt,
          amount: Number(sp.amount),
          method: sp.method,
          supplierName: sp.supplierName,
          createdById: sp.userId,
        });
        result.posted.supplierPayments += 1;
      } catch {
        result.skipped.other += 1;
      }
    }

    // ——— Immobilisations (acquisition) ———
    const assets = await this.prisma.fixedAsset.findMany({
      where: {
        deletedAt: null,
        companyId,
        acquisitionDate: { gte: from, lte: to },
      },
    });
    for (const asset of assets) {
      if (await this.alreadyPosted(companyId, 'FIXED_ASSET', String(asset.id))) {
        result.skipped.alreadyPosted += 1;
        continue;
      }
      try {
        await this.posting.postFixedAssetAcquisition({
          companyId,
          fixedAssetId: asset.id,
          entryDate: asset.acquisitionDate,
          amount: Number(asset.acquisitionCost),
          assetName: asset.name,
          paidFrom: 'CASH',
          createdById: asset.createdById,
        });
        result.posted.fixedAssets += 1;
      } catch {
        result.skipped.other += 1;
      }
    }

    await this.audit.log({
      userId,
      action: 'ACCOUNTING_BACKFILL',
      entity: 'FiscalYear',
      entityId: String(fy.id),
      metadata: result as unknown as Record<string, unknown>,
    });

    this.logger.log(
      `Backfill company=${companyId} fy=${fy.label}: ${JSON.stringify(result.posted)}`,
    );
    return result;
  }
}
