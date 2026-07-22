import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceType, GoodsReceiptStatus, Prisma } from '@prisma/client';
import {
  collectPdfBuffer,
  createPdfDoc,
  drawReportHeader,
  drawTableHeader,
  drawTableRow,
  generatedMetaLine,
} from '../../common/pdf/pdf-document';
import { formatDateFr, formatDateTimeFr, formatMoneyHtg } from '../../common/pdf/pdf-format';
import {
  ymdToBusinessDayEnd,
  ymdToBusinessDayStart,
  ymdToBusinessNoon,
} from '../../common/utils/business-timezone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PurchasingService } from '../purchasing/purchasing.service';
import { SalesService } from '../sales/sales.service';
import { CloseCashDto, CreateFinanceEntryDto } from './dto/finance-entry.dto';

export type FinanceLedgerNature = 'all' | 'purchase' | 'sale' | 'expense';

export type FinanceLedgerRow = {
  kind: 'PURCHASE' | 'SALE' | 'EXPENSE';
  id: string;
  occurredAt: string;
  amount: number;
  description: string;
  user: { id: number; fullName: string | null; phone: string } | null;
};

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly purchasingService: PurchasingService,
    private readonly salesService: SalesService,
  ) {}

  private ymdToDateStart(ymd: string): Date {
    try {
      return ymdToBusinessDayStart(ymd);
    } catch {
      throw new BadRequestException('Date invalide');
    }
  }

  private ymdToDateEnd(ymd: string): Date {
    try {
      return ymdToBusinessDayEnd(ymd);
    } catch {
      throw new BadRequestException('Date invalide');
    }
  }

  /** Date « jour » pour une entrée créée manuellement (midi Haïti pour ancrer le jour métier). */
  private entryDateFromYmd(ymd: string): Date {
    try {
      return ymdToBusinessNoon(ymd);
    } catch {
      throw new BadRequestException('entryDate invalide');
    }
  }

  private companyFinanceWhere(companyId: number): Prisma.FinanceEntryWhereInput {
    return {
      OR: [
        { category: { companyId } },
        { categoryId: null, user: { companyId } },
        { categoryId: null, user: { companyId: null } },
      ],
    };
  }

  async journal(opts?: { companyId?: number; skip?: number; take?: number }) {
    const skip = Math.max(0, Math.floor(opts?.skip ?? 0));
    const rawTake = opts?.take ?? 30;
    const take = Math.min(200, Math.max(1, Math.floor(rawTake)));

    const companyFilter =
      opts?.companyId != null ? this.companyFinanceWhere(opts.companyId) : undefined;

    const where: Prisma.FinanceEntryWhereInput | undefined = companyFilter
      ? { deletedAt: null, type: { in: [FinanceType.INCOME, FinanceType.EXPENSE] }, ...companyFilter }
      : { deletedAt: null, type: { in: [FinanceType.INCOME, FinanceType.EXPENSE] } };

    const [items, total] = await Promise.all([
      this.prisma.financeEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
        },
      }),
      this.prisma.financeEntry.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Journal unifié : réceptions d’achat (POSTED), encaissements vente (INCOME), dépenses manuelles (EXPENSE).
   */
  async ledger(opts: {
    companyId: number;
    dateFrom: string;
    dateTo: string;
    nature?: FinanceLedgerNature;
    skip?: number;
    take?: number;
  }): Promise<{ items: FinanceLedgerRow[]; total: number }> {
    const from = this.ymdToDateStart(opts.dateFrom);
    const to = this.ymdToDateEnd(opts.dateTo);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('dateFrom doit être antérieure ou égale à dateTo');
    }

    const nature: FinanceLedgerNature = opts.nature ?? 'all';
    const skip = Math.max(0, Math.floor(opts.skip ?? 0));
    const rawTake = opts.take ?? 30;
    const take = Math.min(200, Math.max(1, Math.floor(rawTake)));

    const companyId = opts.companyId;
    const rows: FinanceLedgerRow[] = [];

    const wantPurchase = nature === 'all' || nature === 'purchase';
    const wantSale = nature === 'all' || nature === 'sale';
    const wantExpense = nature === 'all' || nature === 'expense';

    if (wantPurchase) {
      const receipts = await this.prisma.goodsReceipt.findMany({
        where: {
          deletedAt: null,
          status: GoodsReceiptStatus.POSTED,
          receivedAt: { gte: from, lte: to },
          department: { companyId },
        },
        include: {
          lines: true,
          createdBy: { select: { id: true, fullName: true, phone: true } },
        },
      });
      for (const gr of receipts) {
        const amount = gr.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);
        const note = gr.note?.trim();
        rows.push({
          kind: 'PURCHASE',
          id: `gr-${gr.id}`,
          occurredAt: gr.receivedAt.toISOString(),
          amount,
          description: note ? `${note} (#${gr.id})` : `Réception achat #${gr.id}`,
          user: gr.createdBy,
        });
      }
    }

    if (wantSale || wantExpense) {
      const types: FinanceType[] = [];
      if (wantSale) types.push(FinanceType.INCOME);
      if (wantExpense) types.push(FinanceType.EXPENSE);
      const entries = await this.prisma.financeEntry.findMany({
        where: {
          deletedAt: null,
          type: { in: types },
          createdAt: { gte: from, lte: to },
          ...this.companyFinanceWhere(companyId),
        },
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
        },
      });
      for (const fe of entries) {
        if (fe.type === FinanceType.INCOME) {
          rows.push({
            kind: 'SALE',
            id: `fe-${fe.id}`,
            occurredAt: fe.createdAt.toISOString(),
            amount: Number(fe.amount),
            description: fe.description,
            user: fe.user,
          });
        } else {
          rows.push({
            kind: 'EXPENSE',
            id: `fe-${fe.id}`,
            occurredAt: fe.createdAt.toISOString(),
            amount: Number(fe.amount),
            description: fe.description,
            user: fe.user,
          });
        }
      }
    }

    rows.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
    const total = rows.length;
    const page = rows.slice(skip, skip + take);
    return { items: page, total };
  }

  async exportLedgerPdf(opts: {
    companyId: number;
    dateFrom: string;
    dateTo: string;
    nature?: FinanceLedgerNature;
  }): Promise<Buffer> {
    const company = await this.prisma.company.findUnique({
      where: { id: opts.companyId },
      select: { name: true, logoUrl: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable');

    const { items } = await this.ledger({
      companyId: opts.companyId,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      nature: opts.nature ?? 'all',
      skip: 0,
      take: 200,
    });

    const natureLabel =
      opts.nature === 'purchase'
        ? 'Achats'
        : opts.nature === 'sale'
          ? 'Ventes'
          : opts.nature === 'expense'
            ? 'Dépenses'
            : 'Toutes natures';

    const doc = createPdfDoc({ landscape: true });
    await drawReportHeader(doc, {
      title: 'Journal achats / ventes / dépenses',
      brand: { companyName: company.name, logoUrl: company.logoUrl },
      metaLines: [
        `Période : ${formatDateFr(opts.dateFrom)} → ${formatDateFr(opts.dateTo)}`,
        `Nature : ${natureLabel} · ${items.length} ligne${items.length > 1 ? 's' : ''}`,
        generatedMetaLine(),
      ],
    });

    if (items.length === 0) {
      doc.fontSize(11).fillColor('#64748b').text('Aucune ligne sur cette période.');
    } else {
      const cols = [
        { key: 'date', label: 'Date', width: 110 },
        { key: 'kind', label: 'Nature', width: 80 },
        { key: 'desc', label: 'Libellé', width: 280 },
        { key: 'user', label: 'Utilisateur', width: 120 },
        { key: 'amount', label: 'Montant', width: 100, align: 'right' as const },
      ];
      drawTableHeader(doc, cols);
      const kindFr = (k: FinanceLedgerRow['kind']) =>
        k === 'PURCHASE' ? 'Achat' : k === 'SALE' ? 'Vente' : 'Dépense';
      items.forEach((row, i) => {
        drawTableRow(
          doc,
          cols,
          {
            date: formatDateTimeFr(row.occurredAt),
            kind: kindFr(row.kind),
            desc: row.description,
            user: row.user?.fullName?.trim() || row.user?.phone || '—',
            amount: formatMoneyHtg(row.amount),
          },
          { alt: i % 2 === 1 },
        );
      });
    }

    return collectPdfBuffer(doc);
  }

  async createEntry(dto: CreateFinanceEntryDto, userId?: number) {
    const companyId =
      dto.companyId ??
      (userId != null
        ? (await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } }))
            ?.companyId
        : null);

    // Dépenses manuelles : une des sorties du tableau de bord (avec achats reçus) ; revenus = ventes.
    // If no company can be inferred, we still allow create (categoryId stays null).
    const categoryName = 'Dépenses manuelles';
    let categoryId: number | null = null;

    if (companyId != null) {
      const existing = await this.prisma.expenseCategory.findFirst({
        where: { companyId, name: categoryName },
      });
      if (existing) categoryId = existing.id;
      else {
        const created = await this.prisma.expenseCategory.create({
          data: { companyId, name: categoryName },
        });
        categoryId = created.id;
      }
    }

    const createdAt = dto.entryDate ? this.entryDateFromYmd(dto.entryDate) : undefined;

    const entry = await this.prisma.financeEntry.create({
      data: {
        type: dto.type,
        amount: dto.amount,
        description: dto.description,
        userId,
        categoryId,
        ...(createdAt != null ? { createdAt } : {}),
      },
    });
    await this.auditService.log({
      userId,
      action: 'FINANCE_ENTRY_CREATED',
      entity: 'FinanceEntry',
      entityId: String(entry.id),
      metadata: { type: dto.type, amount: dto.amount },
    });
    return entry;
  }

  async closeCash(dto: CloseCashDto, userId?: number) {
    const variance = dto.countedAmount - dto.expectedAmount;
    const closure = await this.prisma.cashClosure.create({
      data: {
        registerId: dto.registerId,
        expectedAmount: dto.expectedAmount,
        countedAmount: dto.countedAmount,
        variance,
        createdById: userId,
      },
    });
    await this.auditService.log({
      userId,
      action: 'CASH_CLOSURE_CREATED',
      entity: 'CashClosure',
      entityId: String(closure.id),
      metadata: { variance },
    });
    return closure;
  }

  /**
   * Suppression admin d'une ligne du journal unifié, avec effets métier :
   * - achat (gr-*) : annulation stock + soft delete réception ;
   * - vente (fe-* INCOME + saleId) : suppression définitive de la vente ;
   * - dépense (fe-* EXPENSE) : soft delete de l'écriture.
   */
  async deleteLedgerRow(ledgerRowId: string, companyId: number, userId?: number) {
    const trimmed = ledgerRowId.trim();
    const match = /^(gr|fe)-(\d+)$/.exec(trimmed);
    if (!match) {
      throw new BadRequestException('Identifiant de ligne invalide');
    }
    const [, prefix, idStr] = match;
    const refId = Number.parseInt(idStr, 10);
    if (!Number.isFinite(refId) || refId <= 0) {
      throw new BadRequestException('Identifiant de ligne invalide');
    }

    if (prefix === 'gr') {
      const gr = await this.prisma.goodsReceipt.findFirst({
        where: { id: refId, deletedAt: null, status: GoodsReceiptStatus.POSTED },
        include: { department: { select: { companyId: true } } },
      });
      if (!gr || gr.department.companyId !== companyId) {
        throw new NotFoundException('Réception introuvable pour cette entreprise');
      }
      await this.purchasingService.deleteGoodsReceipt(refId, userId);
      return { ok: true, kind: 'PURCHASE' as const, id: trimmed };
    }

    const fe = await this.prisma.financeEntry.findFirst({
      where: {
        id: refId,
        deletedAt: null,
        ...this.companyFinanceWhere(companyId),
      },
    });
    if (!fe) {
      throw new NotFoundException('Écriture introuvable pour cette entreprise');
    }

    if (fe.type === FinanceType.INCOME) {
      let saleId = fe.saleId;
      if (saleId == null) {
        const parsed = /#(\d+)\s*$/.exec(fe.description);
        if (parsed) saleId = Number.parseInt(parsed[1], 10);
      }
      if (saleId == null || !Number.isFinite(saleId)) {
        throw new BadRequestException('Encaissement sans vente liée — suppression impossible.');
      }
      await this.salesService.deleteSalePermanently(saleId, userId, companyId);
      return { ok: true, kind: 'SALE' as const, id: trimmed };
    }

    if (fe.type === FinanceType.EXPENSE) {
      await this.prisma.financeEntry.update({
        where: { id: fe.id },
        data: { deletedAt: new Date() },
      });
      await this.auditService.log({
        userId,
        action: 'FINANCE_ENTRY_DELETED',
        entity: 'FinanceEntry',
        entityId: String(fe.id),
        metadata: { type: fe.type, amount: Number(fe.amount), ledgerRowId: trimmed },
      });
      return { ok: true, kind: 'EXPENSE' as const, id: trimmed };
    }

    throw new BadRequestException('Type de ligne non supprimable');
  }
}
