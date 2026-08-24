import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  JournalCode,
  JournalEntryStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EXPENSE_LABEL_TO_ACCOUNT,
  SYSTEM_KEYS,
  SystemKey,
} from './chart-of-accounts';

export type PostingLine = {
  accountCode?: string;
  systemKey?: SystemKey;
  debit?: number;
  credit?: number;
  label?: string;
};

export type PostEntryInput = {
  companyId: number;
  entryDate: Date;
  journalCode: JournalCode;
  description: string;
  reference?: string | null;
  source: string;
  sourceId: string;
  lines: PostingLine[];
  createdById?: number | null;
  /** Si true, ignore silencieusement si déjà posté (idempotent). */
  skipIfExists?: boolean;
};

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AccountingPostingService {
  private readonly logger = new Logger(AccountingPostingService.name);

  constructor(private readonly prisma: PrismaService) {}

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private asDateOnly(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  async requireOpenFiscalYear(companyId: number, entryDate: Date, db: Db = this.prisma) {
    const day = this.asDateOnly(entryDate);
    const fy = await db.fiscalYear.findFirst({
      where: {
        companyId,
        deletedAt: null,
        status: 'OPEN',
        startDate: { lte: day },
        endDate: { gte: day },
      },
    });
    if (!fy) {
      throw new BadRequestException(
        `Aucun exercice comptable ouvert pour la date ${day.toISOString().slice(0, 10)}. Ouvrez un exercice dans Comptabilité.`,
      );
    }
    return fy;
  }

  async resolveAccountId(
    companyId: number,
    line: PostingLine,
    db: Db,
  ): Promise<{ id: number; code: string }> {
    if (line.systemKey) {
      const acc = await db.account.findFirst({
        where: { companyId, systemKey: line.systemKey, deletedAt: null, isActive: true },
        select: { id: true, code: true },
      });
      if (!acc) {
        throw new BadRequestException(
          `Compte système « ${line.systemKey} » introuvable. Initialisez le plan comptable.`,
        );
      }
      return acc;
    }
    if (!line.accountCode?.trim()) {
      throw new BadRequestException('Compte manquant sur une ligne d’écriture');
    }
    const code = line.accountCode.trim();
    const acc = await db.account.findFirst({
      where: { companyId, code, deletedAt: null, isActive: true },
      select: { id: true, code: true },
    });
    if (!acc) {
      throw new BadRequestException(`Compte ${code} introuvable`);
    }
    return acc;
  }

  /**
   * Enregistre une écriture équilibrée. Idempotent via (companyId, source, sourceId).
   * Ne bloque pas l’opération métier si le plan/exercice n’est pas prêt — log + skip optionnel.
   */
  async postEntry(input: PostEntryInput, db: Db = this.prisma) {
    const existing = await db.journalEntry.findFirst({
      where: {
        companyId: input.companyId,
        source: input.source,
        sourceId: input.sourceId,
        deletedAt: null,
      },
    });
    if (existing) {
      if (input.skipIfExists || existing.status === JournalEntryStatus.POSTED) {
        return existing;
      }
      throw new BadRequestException('Écriture déjà existante pour cette opération');
    }

    const lines = input.lines
      .map((l) => ({
        ...l,
        debit: this.round2(l.debit ?? 0),
        credit: this.round2(l.credit ?? 0),
      }))
      .filter((l) => l.debit > 0.009 || l.credit > 0.009);

    if (lines.length < 2) {
      throw new BadRequestException('Une écriture doit comporter au moins deux lignes');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of lines) {
      if (l.debit > 0 && l.credit > 0) {
        throw new BadRequestException('Une ligne ne peut pas être à la fois débit et crédit');
      }
      totalDebit += l.debit;
      totalCredit += l.credit;
    }
    totalDebit = this.round2(totalDebit);
    totalCredit = this.round2(totalCredit);
    if (Math.abs(totalDebit - totalCredit) > 0.02) {
      throw new BadRequestException(
        `Écriture non équilibrée (D ${totalDebit} ≠ C ${totalCredit})`,
      );
    }

    const fy = await this.requireOpenFiscalYear(input.companyId, input.entryDate, db);
    const entryDate = this.asDateOnly(input.entryDate);

    const last = await db.journalEntry.findFirst({
      where: { fiscalYearId: fy.id, journalCode: input.journalCode, deletedAt: null },
      orderBy: { entryNumber: 'desc' },
      select: { entryNumber: true },
    });
    const entryNumber = (last?.entryNumber ?? 0) + 1;

    const resolved: Array<{
      accountId: number;
      debit: number;
      credit: number;
      label: string | null;
      sortOrder: number;
    }> = [];
    for (let i = 0; i < lines.length; i++) {
      const acc = await this.resolveAccountId(input.companyId, lines[i], db);
      resolved.push({
        accountId: acc.id,
        debit: lines[i].debit,
        credit: lines[i].credit,
        label: lines[i].label ?? null,
        sortOrder: i,
      });
    }

    return db.journalEntry.create({
      data: {
        companyId: input.companyId,
        fiscalYearId: fy.id,
        entryDate,
        journalCode: input.journalCode,
        entryNumber,
        reference: input.reference ?? null,
        description: input.description,
        source: input.source,
        sourceId: input.sourceId,
        status: JournalEntryStatus.POSTED,
        createdById: input.createdById ?? null,
        lines: { create: resolved },
      },
      include: { lines: { include: { account: true } } },
    });
  }

  /** Poste sans faire échouer l’opération métier (log d’erreur). */
  async tryPostEntry(input: PostEntryInput, db: Db = this.prisma): Promise<void> {
    // Sous Postgres, une requête SQL en échec abort toute la transaction parente
    // (ex. vente POS). Un SAVEPOINT isole la compta pour ne pas bloquer l’encaissement.
    const sp = `acct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const useSavepoint = db !== this.prisma;
    try {
      if (useSavepoint) {
        await db.$executeRawUnsafe(`SAVEPOINT ${sp}`);
      }
      await this.postEntry({ ...input, skipIfExists: true }, db);
      if (useSavepoint) {
        await db.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
      }
    } catch (err) {
      if (useSavepoint) {
        try {
          await db.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
        } catch {
          /* ignore */
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Compta non postée [${input.source}:${input.sourceId}]: ${msg}`);
    }
  }

  expenseAccountCode(description: string): string {
    const key = description.trim().toUpperCase();
    return EXPENSE_LABEL_TO_ACCOUNT[key] ?? EXPENSE_LABEL_TO_ACCOUNT['AUTRES DEPENSES'] ?? '628';
  }

  /** Vente caisse / banque (hors crédit pur). */
  async postPosSale(params: {
    companyId: number;
    saleId: number;
    entryDate: Date;
    total: number;
    cashAmount: number;
    bankAmount: number;
    cogs?: number;
    createdById?: number | null;
    txnLabel?: string;
  }, db: Db = this.prisma) {
    const total = this.round2(params.total);
    const cash = this.round2(params.cashAmount);
    const bank = this.round2(params.bankAmount);
    const collected = this.round2(cash + bank);
    if (collected <= 0.009 && total <= 0.009) return;

    const lines: PostingLine[] = [];
    const label = params.txnLabel ?? `Vente #${params.saleId}`;

    if (cash > 0.009) {
      lines.push({ systemKey: SYSTEM_KEYS.CASH, debit: cash, label });
    }
    if (bank > 0.009) {
      lines.push({ systemKey: SYSTEM_KEYS.BANK, debit: bank, label });
    }
    // Écart (ex. split partiel) : reste en clients si non encaissé
    const ar = this.round2(total - collected);
    if (ar > 0.009) {
      lines.push({ systemKey: SYSTEM_KEYS.CUSTOMERS, debit: ar, label: `${label} (reste)` });
    }
    lines.push({ systemKey: SYSTEM_KEYS.SALES, credit: total, label });

    await this.tryPostEntry(
      {
        companyId: params.companyId,
        entryDate: params.entryDate,
        journalCode: cash >= bank ? JournalCode.CA : JournalCode.BQ,
        description: `Vente POS ${label}`,
        source: 'SALE',
        sourceId: String(params.saleId),
        lines,
        createdById: params.createdById,
      },
      db,
    );

    const cogs = this.round2(params.cogs ?? 0);
    if (cogs > 0.009) {
      await this.tryPostEntry(
        {
          companyId: params.companyId,
          entryDate: params.entryDate,
          journalCode: JournalCode.OD,
          description: `Coût des ventes ${label}`,
          source: 'SALE_COGS',
          sourceId: String(params.saleId),
          lines: [
            { systemKey: SYSTEM_KEYS.COGS, debit: cogs, label },
            { systemKey: SYSTEM_KEYS.INVENTORY, credit: cogs, label },
          ],
          createdById: params.createdById,
        },
        db,
      );
    }
  }

  async postCreditSale(params: {
    companyId: number;
    saleId: number;
    entryDate: Date;
    total: number;
    downPayment: number;
    downMethod?: PaymentMethod;
    cogs?: number;
    customerName?: string;
    createdById?: number | null;
  }, db: Db = this.prisma) {
    const total = this.round2(params.total);
    const down = this.round2(params.downPayment);
    if (total <= 0.009) return;
    const label = `Crédit ${params.customerName ?? ''} #${params.saleId}`.trim();

    await this.tryPostEntry(
      {
        companyId: params.companyId,
        entryDate: params.entryDate,
        journalCode: JournalCode.VE,
        description: `Vente à crédit ${label}`,
        source: 'CREDIT_SALE',
        sourceId: String(params.saleId),
        lines: [
          { systemKey: SYSTEM_KEYS.CUSTOMERS, debit: total, label },
          { systemKey: SYSTEM_KEYS.SALES, credit: total, label },
        ],
        createdById: params.createdById,
      },
      db,
    );

    if (down > 0.009) {
      const treasuryKey =
        params.downMethod === PaymentMethod.BANK ? SYSTEM_KEYS.BANK : SYSTEM_KEYS.CASH;
      await this.tryPostEntry(
        {
          companyId: params.companyId,
          entryDate: params.entryDate,
          journalCode:
            params.downMethod === PaymentMethod.BANK ? JournalCode.BQ : JournalCode.CA,
          description: `Acompte crédit ${label}`,
          source: 'CREDIT_DOWN',
          sourceId: String(params.saleId),
          lines: [
            { systemKey: treasuryKey, debit: down, label },
            { systemKey: SYSTEM_KEYS.CUSTOMERS, credit: down, label },
          ],
          createdById: params.createdById,
        },
        db,
      );
    }

    const cogs = this.round2(params.cogs ?? 0);
    if (cogs > 0.009) {
      await this.tryPostEntry(
        {
          companyId: params.companyId,
          entryDate: params.entryDate,
          journalCode: JournalCode.OD,
          description: `Coût des ventes crédit ${label}`,
          source: 'CREDIT_SALE_COGS',
          sourceId: String(params.saleId),
          lines: [
            { systemKey: SYSTEM_KEYS.COGS, debit: cogs, label },
            { systemKey: SYSTEM_KEYS.INVENTORY, credit: cogs, label },
          ],
          createdById: params.createdById,
        },
        db,
      );
    }
  }

  async postCreditPayment(params: {
    companyId: number;
    paymentId: number;
    entryDate: Date;
    amount: number;
    method: PaymentMethod;
    customerName?: string;
    createdById?: number | null;
  }, db: Db = this.prisma) {
    const amount = this.round2(params.amount);
    if (amount <= 0.009) return;
    const treasuryKey =
      params.method === PaymentMethod.BANK ? SYSTEM_KEYS.BANK : SYSTEM_KEYS.CASH;
    const label = `Remb. ${params.customerName ?? ''}`.trim();

    await this.tryPostEntry(
      {
        companyId: params.companyId,
        entryDate: params.entryDate,
        journalCode: params.method === PaymentMethod.BANK ? JournalCode.BQ : JournalCode.CA,
        description: `Encaissement créance client ${label}`,
        source: 'CREDIT_PAYMENT',
        sourceId: String(params.paymentId),
        lines: [
          { systemKey: treasuryKey, debit: amount, label },
          { systemKey: SYSTEM_KEYS.CUSTOMERS, credit: amount, label },
        ],
        createdById: params.createdById,
      },
      db,
    );
  }

  async postExpense(params: {
    companyId: number;
    financeEntryId: number;
    entryDate: Date;
    amount: number;
    description: string;
    createdById?: number | null;
  }, db: Db = this.prisma) {
    const amount = this.round2(params.amount);
    if (amount <= 0.009) return;
    const expenseCode = this.expenseAccountCode(params.description);

    await this.tryPostEntry(
      {
        companyId: params.companyId,
        entryDate: params.entryDate,
        journalCode: JournalCode.CA,
        description: `Dépense — ${params.description}`,
        source: 'EXPENSE',
        sourceId: String(params.financeEntryId),
        lines: [
          { accountCode: expenseCode, debit: amount, label: params.description },
          { systemKey: SYSTEM_KEYS.CASH, credit: amount, label: params.description },
        ],
        createdById: params.createdById,
      },
      db,
    );
  }

  async postPurchaseReceipt(params: {
    companyId: number;
    goodsReceiptId: number;
    entryDate: Date;
    amount: number;
    supplierName?: string | null;
    createdById?: number | null;
  }, db: Db = this.prisma) {
    const amount = this.round2(params.amount);
    if (amount <= 0.009) return;
    const label = params.supplierName?.trim() || `Réception #${params.goodsReceiptId}`;

    await this.tryPostEntry(
      {
        companyId: params.companyId,
        entryDate: params.entryDate,
        journalCode: JournalCode.AC,
        description: `Achat stock — ${label}`,
        source: 'PURCHASE',
        sourceId: String(params.goodsReceiptId),
        lines: [
          { systemKey: SYSTEM_KEYS.INVENTORY, debit: amount, label },
          { systemKey: SYSTEM_KEYS.SUPPLIERS, credit: amount, label },
        ],
        createdById: params.createdById,
      },
      db,
    );
  }

  async postBankTransaction(params: {
    companyId: number;
    transactionId: number;
    entryDate: Date;
    amount: number;
    type: 'DEPOSIT' | 'WITHDRAWAL';
    description: string;
    createdById?: number | null;
  }, db: Db = this.prisma) {
    const amount = this.round2(params.amount);
    if (amount <= 0.009) return;
    const label = params.description;

    // Dépôt : banque ↑ / caisse ↓ (ou produits divers) — retrait inverse.
    // Convention POS : mouvement manuel banque ↔ caisse.
    if (params.type === 'DEPOSIT') {
      await this.tryPostEntry(
        {
          companyId: params.companyId,
          entryDate: params.entryDate,
          journalCode: JournalCode.BQ,
          description: `Banque — dépôt — ${label}`,
          source: 'BANK',
          sourceId: String(params.transactionId),
          lines: [
            { systemKey: SYSTEM_KEYS.BANK, debit: amount, label },
            { systemKey: SYSTEM_KEYS.CASH, credit: amount, label },
          ],
          createdById: params.createdById,
        },
        db,
      );
    } else {
      await this.tryPostEntry(
        {
          companyId: params.companyId,
          entryDate: params.entryDate,
          journalCode: JournalCode.BQ,
          description: `Banque — retrait — ${label}`,
          source: 'BANK',
          sourceId: String(params.transactionId),
          lines: [
            { systemKey: SYSTEM_KEYS.CASH, debit: amount, label },
            { systemKey: SYSTEM_KEYS.BANK, credit: amount, label },
          ],
          createdById: params.createdById,
        },
        db,
      );
    }
  }

  async postSupplierPayment(params: {
    companyId: number;
    paymentId: number;
    entryDate: Date;
    amount: number;
    method: PaymentMethod;
    supplierName: string;
    createdById?: number | null;
  }, db: Db = this.prisma) {
    const amount = this.round2(params.amount);
    if (amount <= 0.009) return;
    const treasuryKey =
      params.method === PaymentMethod.BANK ? SYSTEM_KEYS.BANK : SYSTEM_KEYS.CASH;
    const label = params.supplierName.trim() || `Fournisseur #${params.paymentId}`;

    await this.tryPostEntry(
      {
        companyId: params.companyId,
        entryDate: params.entryDate,
        journalCode: params.method === PaymentMethod.BANK ? JournalCode.BQ : JournalCode.CA,
        description: `Paiement fournisseur — ${label}`,
        source: 'SUPPLIER_PAYMENT',
        sourceId: String(params.paymentId),
        lines: [
          { systemKey: SYSTEM_KEYS.SUPPLIERS, debit: amount, label },
          { systemKey: treasuryKey, credit: amount, label },
        ],
        createdById: params.createdById,
      },
      db,
    );
  }

  async postDepreciation(params: {
    companyId: number;
    fixedAssetId: number;
    period: string;
    entryDate: Date;
    amount: number;
    assetName: string;
    createdById?: number | null;
  }, db: Db = this.prisma) {
    const amount = this.round2(params.amount);
    if (amount <= 0.009) return;
    const label = `${params.assetName} — ${params.period}`;

    await this.tryPostEntry(
      {
        companyId: params.companyId,
        entryDate: params.entryDate,
        journalCode: JournalCode.OD,
        description: `Dotation aux amortissements — ${label}`,
        source: 'DEPRECIATION',
        sourceId: `${params.fixedAssetId}:${params.period}`,
        lines: [
          { accountCode: '681', debit: amount, label },
          { systemKey: SYSTEM_KEYS.ACCUM_DEPR, credit: amount, label },
        ],
        createdById: params.createdById,
      },
      db,
    );
  }

  /** Acquisition d’immobilisation : Dr 215 / Cr Caisse|Banque|Fournisseurs. */
  async postFixedAssetAcquisition(params: {
    companyId: number;
    fixedAssetId: number;
    entryDate: Date;
    amount: number;
    assetName: string;
    paidFrom: 'CASH' | 'BANK' | 'SUPPLIER';
    createdById?: number | null;
  }, db: Db = this.prisma) {
    const amount = this.round2(params.amount);
    if (amount <= 0.009) return;
    const creditKey =
      params.paidFrom === 'BANK'
        ? SYSTEM_KEYS.BANK
        : params.paidFrom === 'SUPPLIER'
          ? SYSTEM_KEYS.SUPPLIERS
          : SYSTEM_KEYS.CASH;
    const label = params.assetName;

    await this.tryPostEntry(
      {
        companyId: params.companyId,
        entryDate: params.entryDate,
        journalCode: JournalCode.OD,
        description: `Acquisition immobilisation — ${label}`,
        source: 'FIXED_ASSET',
        sourceId: String(params.fixedAssetId),
        lines: [
          { systemKey: SYSTEM_KEYS.FIXED_ASSETS, debit: amount, label },
          { systemKey: creditKey, credit: amount, label },
        ],
        createdById: params.createdById,
      },
      db,
    );
  }

  async voidBySource(companyId: number, source: string, sourceId: string, db: Db = this.prisma) {
    const entry = await db.journalEntry.findFirst({
      where: { companyId, source, sourceId, deletedAt: null, status: JournalEntryStatus.POSTED },
    });
    if (!entry) return;
    await db.journalEntry.update({
      where: { id: entry.id },
      data: {
        status: JournalEntryStatus.VOID,
        sourceId: `${sourceId}:void:${entry.id}`,
      },
    });
  }
}
