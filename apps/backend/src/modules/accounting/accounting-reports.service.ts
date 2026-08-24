import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountNature, JournalEntryStatus } from '@prisma/client';
import {
  collectPdfBuffer,
  createPdfDoc,
  drawReportHeader,
  drawTableHeader,
  drawTableRow,
  generatedMetaLine,
  PdfColumn,
  PdfDoc,
} from '../../common/pdf/pdf-document';
import { formatDateFr, formatMoneyHtg } from '../../common/pdf/pdf-format';
import { PrismaService } from '../../prisma/prisma.service';

export type AccountBalanceRow = {
  accountId: number;
  code: string;
  name: string;
  classNumber: number;
  nature: AccountNature;
  isDebitNormal: boolean;
  debit: number;
  credit: number;
  balance: number;
  balanceSide: 'debit' | 'credit' | 'zero';
};

@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private dateOnly(ymd: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) throw new BadRequestException('Date invalide (YYYY-MM-DD)');
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  private async resolvePeriod(params: {
    companyId: number;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
  }) {
    let fy = params.fiscalYearId
      ? await this.prisma.fiscalYear.findFirst({
          where: { id: params.fiscalYearId, companyId: params.companyId, deletedAt: null },
        })
      : await this.prisma.fiscalYear.findFirst({
          where: { companyId: params.companyId, deletedAt: null, status: 'OPEN' },
          orderBy: { startDate: 'desc' },
        });

    if (!fy) {
      throw new BadRequestException('Aucun exercice comptable — ouvrez un exercice d’abord');
    }

    let from = fy.startDate;
    let to = fy.endDate;
    if (params.dateFrom) {
      from = this.dateOnly(params.dateFrom);
      if (from < fy.startDate || from > fy.endDate) {
        throw new BadRequestException('dateFrom hors exercice');
      }
    }
    if (params.dateTo) {
      to = this.dateOnly(params.dateTo);
      if (to < fy.startDate || to > fy.endDate) {
        throw new BadRequestException('dateTo hors exercice');
      }
    }
    if (from > to) throw new BadRequestException('Période invalide');

    return { fy, from, to };
  }

  private async companyHeader(companyId: number) {
    const c = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Entreprise introuvable');
    return c;
  }

  async trialBalance(params: {
    companyId: number;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{
    fiscalYear: { id: number; label: string; status: string };
    dateFrom: string;
    dateTo: string;
    rows: AccountBalanceRow[];
    totals: { debit: number; credit: number };
    /** Totaux des soldes (colonne Débit / Crédit) pour contrôle d’équilibre */
    balanceTotals: { debit: number; credit: number };
    balanced: boolean;
  }> {
    const { fy, from, to } = await this.resolvePeriod(params);
    const accounts = await this.prisma.account.findMany({
      where: { companyId: params.companyId, deletedAt: null, isActive: true },
      orderBy: [{ classNumber: 'asc' }, { code: 'asc' }],
    });

    const agg = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: {
          companyId: params.companyId,
          fiscalYearId: fy.id,
          status: JournalEntryStatus.POSTED,
          deletedAt: null,
          entryDate: { gte: from, lte: to },
        },
      },
      _sum: { debit: true, credit: true },
    });
    const map = new Map(agg.map((a) => [a.accountId, a]));

    const rows: AccountBalanceRow[] = [];
    let totalDebit = 0;
    let totalCredit = 0;
    let balanceDebit = 0;
    let balanceCredit = 0;

    for (const acc of accounts) {
      const s = map.get(acc.id);
      const debit = this.round2(Number(s?._sum.debit ?? 0));
      const credit = this.round2(Number(s?._sum.credit ?? 0));
      if (debit < 0.01 && credit < 0.01) continue;
      const raw = this.round2(debit - credit);
      let balance = 0;
      let balanceSide: 'debit' | 'credit' | 'zero' = 'zero';
      if (Math.abs(raw) < 0.01) {
        balanceSide = 'zero';
      } else if (raw > 0) {
        balance = raw;
        balanceSide = 'debit';
        balanceDebit += balance;
      } else {
        balance = -raw;
        balanceSide = 'credit';
        balanceCredit += balance;
      }
      totalDebit += debit;
      totalCredit += credit;
      rows.push({
        accountId: acc.id,
        code: acc.code,
        name: acc.name,
        classNumber: acc.classNumber,
        nature: acc.nature,
        isDebitNormal: acc.isDebitNormal,
        debit,
        credit,
        balance,
        balanceSide,
      });
    }

    const balanceTotals = {
      debit: this.round2(balanceDebit),
      credit: this.round2(balanceCredit),
    };

    return {
      fiscalYear: { id: fy.id, label: fy.label, status: fy.status },
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
      rows,
      totals: { debit: this.round2(totalDebit), credit: this.round2(totalCredit) },
      balanceTotals,
      balanced: Math.abs(balanceTotals.debit - balanceTotals.credit) < 0.01,
    };
  }

  async generalLedger(params: {
    companyId: number;
    accountId?: number;
    accountCode?: string;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const { fy, from, to } = await this.resolvePeriod(params);
    let account = null as Awaited<ReturnType<typeof this.prisma.account.findFirst>>;
    if (params.accountId != null) {
      account = await this.prisma.account.findFirst({
        where: { id: params.accountId, companyId: params.companyId, deletedAt: null },
      });
    } else if (params.accountCode) {
      account = await this.prisma.account.findFirst({
        where: {
          code: params.accountCode.trim(),
          companyId: params.companyId,
          deletedAt: null,
        },
      });
    }
    if (!account) throw new BadRequestException('Compte requis (accountId ou accountCode)');

    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId: account.id,
        journalEntry: {
          companyId: params.companyId,
          fiscalYearId: fy.id,
          status: JournalEntryStatus.POSTED,
          deletedAt: null,
          entryDate: { gte: from, lte: to },
        },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { sortOrder: 'asc' }],
      include: {
        journalEntry: {
          select: {
            id: true,
            entryDate: true,
            journalCode: true,
            entryNumber: true,
            description: true,
            reference: true,
            source: true,
          },
        },
      },
    });

    let running = 0;
    const movements = lines.map((l) => {
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      running = this.round2(running + debit - credit);
      return {
        entryId: l.journalEntry.id,
        entryDate: l.journalEntry.entryDate.toISOString().slice(0, 10),
        journalCode: l.journalEntry.journalCode,
        entryNumber: l.journalEntry.entryNumber,
        description: l.journalEntry.description,
        reference: l.journalEntry.reference,
        label: l.label,
        debit,
        credit,
        balance: running,
      };
    });

    return {
      fiscalYear: { id: fy.id, label: fy.label, status: fy.status },
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        classNumber: account.classNumber,
      },
      movements,
      closingBalance: running,
    };
  }

  async balanceSheet(params: {
    companyId: number;
    fiscalYearId?: number;
    dateTo?: string;
  }) {
    const trial = await this.trialBalance({
      companyId: params.companyId,
      fiscalYearId: params.fiscalYearId,
      dateTo: params.dateTo,
    });

    const actif: AccountBalanceRow[] = [];
    const passif: AccountBalanceRow[] = [];

    for (const row of trial.rows) {
      if (row.nature !== AccountNature.BALANCE_SHEET) continue;
      // Actif : classes 2, 3, 5 + clients (411) solde débiteur
      // Passif : classes 1, fournisseurs, etc. solde créditeur
      if (row.classNumber === 2 || row.classNumber === 3 || row.classNumber === 5) {
        if (row.balanceSide === 'debit') actif.push(row);
        else if (row.balanceSide === 'credit') passif.push(row);
      } else if (row.classNumber === 1) {
        if (row.balanceSide === 'credit') passif.push(row);
        else if (row.balanceSide === 'debit') actif.push(row);
      } else if (row.classNumber === 4) {
        if (row.balanceSide === 'debit') actif.push(row);
        else if (row.balanceSide === 'credit') passif.push(row);
      }
    }

    // Résultat courant (6/7) non encore clôturé → intégrer au passif (bénéfice) ou actif (perte)
    let resultNet = 0;
    for (const row of trial.rows) {
      if (row.nature !== AccountNature.INCOME_STATEMENT) continue;
      if (row.classNumber === 7) {
        resultNet += row.balanceSide === 'credit' ? row.balance : -row.balance;
      } else if (row.classNumber === 6) {
        resultNet -= row.balanceSide === 'debit' ? row.balance : -row.balance;
      }
    }
    resultNet = this.round2(resultNet);

    if (Math.abs(resultNet) >= 0.01) {
      const synthetic: AccountBalanceRow = {
        accountId: -1,
        code: '120*',
        name: "Résultat de l'exercice (en cours)",
        classNumber: 1,
        nature: AccountNature.BALANCE_SHEET,
        isDebitNormal: false,
        debit: resultNet < 0 ? Math.abs(resultNet) : 0,
        credit: resultNet > 0 ? resultNet : 0,
        balance: Math.abs(resultNet),
        balanceSide: resultNet >= 0 ? 'credit' : 'debit',
      };
      if (resultNet >= 0) passif.push(synthetic);
      else actif.push(synthetic);
    }

    const totalActif = this.round2(
      actif.reduce((s, r) => s + (r.balanceSide === 'debit' ? r.balance : -r.balance), 0),
    );
    const totalPassif = this.round2(
      passif.reduce((s, r) => s + (r.balanceSide === 'credit' ? r.balance : -r.balance), 0),
    );

    return {
      fiscalYear: trial.fiscalYear,
      dateFrom: trial.dateFrom,
      dateTo: trial.dateTo,
      actif,
      passif,
      totalActif: Math.abs(totalActif),
      totalPassif: Math.abs(totalPassif),
      balanced: Math.abs(Math.abs(totalActif) - Math.abs(totalPassif)) < 0.05,
      resultatEnCours: resultNet,
    };
  }

  async incomeStatement(params: {
    companyId: number;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const trial = await this.trialBalance(params);
    const charges = trial.rows.filter((r) => r.classNumber === 6);
    const produits = trial.rows.filter((r) => r.classNumber === 7);

    const totalCharges = this.round2(
      charges.reduce((s, r) => {
        const net = r.balanceSide === 'debit' ? r.balance : -r.balance;
        return s + net;
      }, 0),
    );
    const totalProduits = this.round2(
      produits.reduce((s, r) => {
        const net = r.balanceSide === 'credit' ? r.balance : -r.balance;
        return s + net;
      }, 0),
    );
    const resultat = this.round2(totalProduits - totalCharges);

    return {
      fiscalYear: trial.fiscalYear,
      dateFrom: trial.dateFrom,
      dateTo: trial.dateTo,
      charges,
      produits,
      totalCharges,
      totalProduits,
      resultat,
      resultatLabel: resultat >= 0 ? 'Bénéfice' : 'Perte',
    };
  }

  private async drawFormalHeader(
    doc: PdfDoc,
    companyId: number,
    title: string,
    meta: string[],
  ): Promise<number> {
    const c = await this.companyHeader(companyId);
    const formal = [
      c.legalName?.trim() || c.name,
      c.taxId?.trim() ? `NIF / Identifiant fiscal : ${c.taxId.trim()}` : null,
      [c.address, c.city, c.country].filter(Boolean).join(', ') || null,
      c.phone?.trim() ? `Tél. ${c.phone.trim()}` : null,
      c.email?.trim() || null,
    ].filter(Boolean) as string[];

    return drawReportHeader(doc, {
      title,
      brand: {
        companyName: c.legalName?.trim() || c.name,
        logoUrl: c.logoUrl,
        subtitle: c.headerText?.trim() || undefined,
      },
      metaLines: [...formal, ...meta, generatedMetaLine()],
    });
  }

  async exportTrialBalancePdf(params: {
    companyId: number;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Buffer> {
    const data = await this.trialBalance(params);
    const doc = createPdfDoc({ landscape: true });
    await this.drawFormalHeader(doc, params.companyId, 'Balance générale des comptes', [
      `Exercice : ${data.fiscalYear.label}`,
      `Période : ${formatDateFr(data.dateFrom)} — ${formatDateFr(data.dateTo)}`,
    ]);

    const cols: PdfColumn[] = [
      { key: 'code', label: 'N°', width: 55 },
      { key: 'name', label: 'Intitulé', width: 220 },
      { key: 'debit', label: 'Débit', width: 90, align: 'right' },
      { key: 'credit', label: 'Crédit', width: 90, align: 'right' },
      { key: 'soldeD', label: 'Solde D', width: 90, align: 'right' },
      { key: 'soldeC', label: 'Solde C', width: 90, align: 'right' },
    ];
    drawTableHeader(doc, cols);
    data.rows.forEach((r, i) => {
      drawTableRow(
        doc,
        cols,
        {
          code: r.code,
          name: r.name,
          debit: formatMoneyHtg(r.debit),
          credit: formatMoneyHtg(r.credit),
          soldeD: r.balanceSide === 'debit' ? formatMoneyHtg(r.balance) : '—',
          soldeC: r.balanceSide === 'credit' ? formatMoneyHtg(r.balance) : '—',
        },
        { alt: i % 2 === 1 },
      );
    });
    drawTableRow(doc, cols, {
      code: '',
      name: 'TOTAUX MOUVEMENTS',
      debit: formatMoneyHtg(data.totals.debit),
      credit: formatMoneyHtg(data.totals.credit),
      soldeD: formatMoneyHtg(data.balanceTotals.debit),
      soldeC: formatMoneyHtg(data.balanceTotals.credit),
    });
    return collectPdfBuffer(doc);
  }

  async exportBalanceSheetPdf(params: {
    companyId: number;
    fiscalYearId?: number;
    dateTo?: string;
  }): Promise<Buffer> {
    const data = await this.balanceSheet(params);
    const doc = createPdfDoc();
    await this.drawFormalHeader(doc, params.companyId, 'Bilan comptable', [
      `Exercice : ${data.fiscalYear.label}`,
      `Arrêté au : ${formatDateFr(data.dateTo)}`,
      data.balanced ? 'Bilan équilibré' : 'Attention : bilan non équilibré',
    ]);

    const cols: PdfColumn[] = [
      { key: 'code', label: 'N°', width: 50 },
      { key: 'name', label: 'Libellé', width: 280 },
      { key: 'amount', label: 'Montant', width: 100, align: 'right' },
    ];

    doc.fontSize(11).fillColor('#0f766e').text('ACTIF');
    doc.moveDown(0.3);
    drawTableHeader(doc, cols);
    data.actif.forEach((r, i) => {
      drawTableRow(
        doc,
        cols,
        { code: r.code, name: r.name, amount: formatMoneyHtg(r.balance) },
        { alt: i % 2 === 1 },
      );
    });
    drawTableRow(doc, cols, {
      code: '',
      name: 'TOTAL ACTIF',
      amount: formatMoneyHtg(data.totalActif),
    });
    doc.moveDown(0.8);
    doc.fontSize(11).fillColor('#0f766e').text('PASSIF');
    doc.moveDown(0.3);
    drawTableHeader(doc, cols);
    data.passif.forEach((r, i) => {
      drawTableRow(
        doc,
        cols,
        { code: r.code, name: r.name, amount: formatMoneyHtg(r.balance) },
        { alt: i % 2 === 1 },
      );
    });
    drawTableRow(doc, cols, {
      code: '',
      name: 'TOTAL PASSIF',
      amount: formatMoneyHtg(data.totalPassif),
    });
    return collectPdfBuffer(doc);
  }

  async exportIncomeStatementPdf(params: {
    companyId: number;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Buffer> {
    const data = await this.incomeStatement(params);
    const doc = createPdfDoc();
    await this.drawFormalHeader(doc, params.companyId, 'Compte de résultat', [
      `Exercice : ${data.fiscalYear.label}`,
      `Période : ${formatDateFr(data.dateFrom)} — ${formatDateFr(data.dateTo)}`,
    ]);

    const cols: PdfColumn[] = [
      { key: 'code', label: 'N°', width: 50 },
      { key: 'name', label: 'Libellé', width: 280 },
      { key: 'amount', label: 'Montant', width: 100, align: 'right' },
    ];

    doc.fontSize(11).fillColor('#0f766e').text('PRODUITS (classe 7)');
    doc.moveDown(0.3);
    drawTableHeader(doc, cols);
    data.produits.forEach((r, i) => {
      const amt = r.balanceSide === 'credit' ? r.balance : -r.balance;
      drawTableRow(
        doc,
        cols,
        { code: r.code, name: r.name, amount: formatMoneyHtg(amt) },
        { alt: i % 2 === 1 },
      );
    });
    drawTableRow(doc, cols, {
      code: '',
      name: 'Total produits',
      amount: formatMoneyHtg(data.totalProduits),
    });
    doc.moveDown(0.6);
    doc.fontSize(11).fillColor('#0f766e').text('CHARGES (classe 6)');
    doc.moveDown(0.3);
    drawTableHeader(doc, cols);
    data.charges.forEach((r, i) => {
      const amt = r.balanceSide === 'debit' ? r.balance : -r.balance;
      drawTableRow(
        doc,
        cols,
        { code: r.code, name: r.name, amount: formatMoneyHtg(amt) },
        { alt: i % 2 === 1 },
      );
    });
    drawTableRow(doc, cols, {
      code: '',
      name: 'Total charges',
      amount: formatMoneyHtg(data.totalCharges),
    });
    doc.moveDown(0.5);
    drawTableRow(doc, cols, {
      code: '',
      name: data.resultatLabel,
      amount: formatMoneyHtg(Math.abs(data.resultat)),
    });
    return collectPdfBuffer(doc);
  }

  async exportJournalPdf(params: {
    companyId: number;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Buffer> {
    const { fy, from, to } = await this.resolvePeriod(params);
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        companyId: params.companyId,
        fiscalYearId: fy.id,
        status: JournalEntryStatus.POSTED,
        deletedAt: null,
        entryDate: { gte: from, lte: to },
      },
      orderBy: [{ entryDate: 'asc' }, { journalCode: 'asc' }, { entryNumber: 'asc' }],
      include: {
        lines: {
          orderBy: { sortOrder: 'asc' },
          include: { account: { select: { code: true, name: true } } },
        },
      },
      take: 2000,
    });

    const doc = createPdfDoc({ landscape: true });
    await this.drawFormalHeader(doc, params.companyId, 'Journal comptable', [
      `Exercice : ${fy.label}`,
      `Période : ${formatDateFr(from.toISOString().slice(0, 10))} — ${formatDateFr(to.toISOString().slice(0, 10))}`,
      `${entries.length} écriture(s)`,
    ]);

    const cols: PdfColumn[] = [
      { key: 'date', label: 'Date', width: 70 },
      { key: 'num', label: 'N°', width: 55 },
      { key: 'code', label: 'Compte', width: 50 },
      { key: 'label', label: 'Libellé', width: 260 },
      { key: 'debit', label: 'Débit', width: 90, align: 'right' },
      { key: 'credit', label: 'Crédit', width: 90, align: 'right' },
    ];
    drawTableHeader(doc, cols);

    let i = 0;
    for (const e of entries) {
      const num = `${e.journalCode}-${String(e.entryNumber).padStart(5, '0')}`;
      for (const l of e.lines) {
        drawTableRow(
          doc,
          cols,
          {
            date: formatDateFr(e.entryDate.toISOString().slice(0, 10)),
            num,
            code: l.account.code,
            label: l.label || e.description,
            debit: Number(l.debit) > 0 ? formatMoneyHtg(Number(l.debit)) : '',
            credit: Number(l.credit) > 0 ? formatMoneyHtg(Number(l.credit)) : '',
          },
          { alt: i % 2 === 1 },
        );
        i += 1;
      }
    }
    return collectPdfBuffer(doc);
  }

  async exportGeneralLedgerPdf(params: {
    companyId: number;
    accountId?: number;
    accountCode?: string;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Buffer> {
    // Sans compte : grand livre récapitulatif (2 colonnes de soldes + totaux)
    if (params.accountId == null && !params.accountCode?.trim()) {
      return this.exportGeneralLedgerSummaryPdf(params);
    }

    const data = await this.generalLedger(params);
    const doc = createPdfDoc({ landscape: true });
    await this.drawFormalHeader(
      doc,
      params.companyId,
      `Grand livre — ${data.account.code} ${data.account.name}`,
      [
        `Exercice : ${data.fiscalYear.label}`,
        `Période : ${formatDateFr(data.dateFrom)} — ${formatDateFr(data.dateTo)}`,
      ],
    );

    const cols: PdfColumn[] = [
      { key: 'date', label: 'Date', width: 70 },
      { key: 'num', label: 'N°', width: 60 },
      { key: 'label', label: 'Libellé', width: 260 },
      { key: 'debit', label: 'Débit', width: 85, align: 'right' },
      { key: 'credit', label: 'Crédit', width: 85, align: 'right' },
      { key: 'balance', label: 'Solde', width: 85, align: 'right' },
    ];
    drawTableHeader(doc, cols);
    data.movements.forEach((m, i) => {
      drawTableRow(
        doc,
        cols,
        {
          date: formatDateFr(m.entryDate),
          num: `${m.journalCode}-${String(m.entryNumber).padStart(5, '0')}`,
          label: m.label || m.description,
          debit: m.debit > 0 ? formatMoneyHtg(m.debit) : '',
          credit: m.credit > 0 ? formatMoneyHtg(m.credit) : '',
          balance: formatMoneyHtg(m.balance),
        },
        { alt: i % 2 === 1 },
      );
    });
    drawTableRow(doc, cols, {
      date: '',
      num: '',
      label: 'Solde de clôture',
      debit: '',
      credit: '',
      balance: formatMoneyHtg(data.closingBalance),
    });
    return collectPdfBuffer(doc);
  }

  /** Grand livre : comptes en deux colonnes (soldes débiteurs / créditeurs) + totaux */
  private async exportGeneralLedgerSummaryPdf(params: {
    companyId: number;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Buffer> {
    const data = await this.trialBalance(params);
    const debitRows = data.rows.filter((r) => r.balanceSide === 'debit');
    const creditRows = data.rows.filter((r) => r.balanceSide === 'credit');
    const rowCount = Math.max(debitRows.length, creditRows.length, 1);

    const doc = createPdfDoc({ landscape: true });
    await this.drawFormalHeader(doc, params.companyId, 'Grand livre des comptes', [
      `Exercice : ${data.fiscalYear.label}`,
      `Période : ${formatDateFr(data.dateFrom)} — ${formatDateFr(data.dateTo)}`,
      data.balanced ? 'Balance équilibrée' : 'Attention : soldes déséquilibrés',
    ]);

    const cols: PdfColumn[] = [
      { key: 'dCode', label: 'N°', width: 45 },
      { key: 'dName', label: 'Soldes débiteurs', width: 200 },
      { key: 'dBal', label: 'Solde', width: 85, align: 'right' },
      { key: 'cCode', label: 'N°', width: 45 },
      { key: 'cName', label: 'Soldes créditeurs', width: 200 },
      { key: 'cBal', label: 'Solde', width: 85, align: 'right' },
    ];
    drawTableHeader(doc, cols);

    for (let i = 0; i < rowCount; i += 1) {
      const d = debitRows[i];
      const c = creditRows[i];
      if (!d && !c) continue;
      drawTableRow(
        doc,
        cols,
        {
          dCode: d?.code ?? '',
          dName: d?.name ?? '',
          dBal: d ? formatMoneyHtg(d.balance) : '',
          cCode: c?.code ?? '',
          cName: c?.name ?? '',
          cBal: c ? formatMoneyHtg(c.balance) : '',
        },
        { alt: i % 2 === 1 },
      );
    }

    drawTableRow(doc, cols, {
      dCode: '',
      dName: 'TOTAL DÉBIT',
      dBal: formatMoneyHtg(data.balanceTotals.debit),
      cCode: '',
      cName: 'TOTAL CRÉDIT',
      cBal: formatMoneyHtg(data.balanceTotals.credit),
    });

    return collectPdfBuffer(doc);
  }
}
