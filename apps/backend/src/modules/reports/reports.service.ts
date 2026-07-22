import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  businessPeriodBounds,
  nowBusinessYmd,
  shiftBusinessYmd,
  ymdToBusinessDayStart,
  ymdToBusinessDayEnd,
} from '../../common/utils/business-timezone';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** null = toutes les entreprises ; sinon ids uniques. */
  private normalizeCompanyIds(companyIds?: number[]): number[] | null {
    if (!companyIds?.length) return null;
    const ids = [...new Set(companyIds.filter((id) => Number.isFinite(id) && id > 0))];
    return ids.length ? ids : null;
  }

  parseCompanyIdsQuery(companyIdsRaw?: string, companyIdRaw?: string): number[] | undefined {
    const fromList = companyIdsRaw
      ?.split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (fromList?.length) return [...new Set(fromList)];
    const single = companyIdsRaw ? Number.parseInt(companyIdsRaw, 10) : NaN;
    if (Number.isFinite(single) && single > 0) return [single];
    return undefined;
  }

  async revenue() {
    const now = new Date();
    const { from: dayStart } = businessPeriodBounds('day', now);
    const { from: weekStart } = businessPeriodBounds('week', now);
    const { from: monthStart } = businessPeriodBounds('month', now);

    const [day, week, month] = await Promise.all([
      this.sumByDate(dayStart),
      this.sumByDate(weekStart),
      this.sumByDate(monthStart),
    ]);
    return { day, week, month };
  }

  topProducts() {
    return this.prisma.saleItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
    });
  }

  async salesByCashier() {
    const grouped = await this.prisma.sale.groupBy({
      by: ['userId'],
      where: { deletedAt: null },
      _sum: { total: true },
      _count: { id: true },
      orderBy: { _sum: { total: 'desc' } },
    });
    const userIds = grouped.map((g) => g.userId).filter((id): id is number => id != null);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true, phone: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return grouped.map((g) => ({
      userId: g.userId,
      user: g.userId != null ? userMap.get(g.userId) ?? null : null,
      total: g._sum.total,
      count: g._count.id,
    }));
  }

  async margin() {
    const items = await this.prisma.saleItem.findMany({
      include: { product: true },
    });
    const revenue = items.reduce((acc, item) => acc + Number(item.subtotal), 0);
    const cost = items.reduce(
      (acc, item) => acc + Number(item.product.cost) * Number(item.baseQuantity),
      0,
    );
    return { revenue, cost, margin: revenue - cost };
  }

  private async sumByDate(fromDate: Date) {
    const res = await this.prisma.sale.aggregate({
      where: { createdAt: { gte: fromDate }, status: 'COMPLETED', deletedAt: null },
      _sum: { total: true },
    });
    return Number(res._sum.total ?? 0);
  }

  private async sumSales(fromDate: Date, toDate: Date, companyIds?: number[]) {
    const ids = this.normalizeCompanyIds(companyIds);
    if (ids == null) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(si."subtotal"), 0) AS "total"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL
          AND s."createdAt" >= ${fromDate}
          AND s."createdAt" < ${toDate};
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    if (ids.length === 1) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(si."subtotal"), 0) AS "total"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        JOIN "Product" p ON p.id = si."productId"
        WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL
          AND p."companyId" = ${ids[0]}
          AND s."createdAt" >= ${fromDate}
          AND s."createdAt" < ${toDate};
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(si."subtotal"), 0) AS "total"
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Product" p ON p.id = si."productId"
      WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL
        AND p."companyId" IN (${Prisma.join(ids)})
        AND s."createdAt" >= ${fromDate}
        AND s."createdAt" < ${toDate};
    `;
    return Number(res?.[0]?.total ?? 0);
  }

  private async sumPurchasesReceived(fromDate: Date, toDate: Date, companyIds?: number[]) {
    const ids = this.normalizeCompanyIds(companyIds);
    if (ids == null) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(grl."quantity" * grl."unitCost"), 0) AS "total"
        FROM "GoodsReceiptLine" grl
        JOIN "GoodsReceipt" gr ON gr.id = grl."goodsReceiptId"
        WHERE gr."status" = 'POSTED'
          AND gr."deletedAt" IS NULL
          AND gr."receivedAt" >= ${fromDate}
          AND gr."receivedAt" < ${toDate};
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    if (ids.length === 1) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(grl."quantity" * grl."unitCost"), 0) AS "total"
        FROM "GoodsReceiptLine" grl
        JOIN "GoodsReceipt" gr ON gr.id = grl."goodsReceiptId"
        JOIN "Department" d ON d.id = gr."departmentId"
        WHERE gr."status" = 'POSTED'
          AND gr."deletedAt" IS NULL
          AND d."companyId" = ${ids[0]}
          AND gr."receivedAt" >= ${fromDate}
          AND gr."receivedAt" < ${toDate};
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(grl."quantity" * grl."unitCost"), 0) AS "total"
      FROM "GoodsReceiptLine" grl
      JOIN "GoodsReceipt" gr ON gr.id = grl."goodsReceiptId"
      JOIN "Department" d ON d.id = gr."departmentId"
      WHERE gr."status" = 'POSTED'
        AND gr."deletedAt" IS NULL
        AND d."companyId" IN (${Prisma.join(ids)})
        AND gr."receivedAt" >= ${fromDate}
        AND gr."receivedAt" < ${toDate};
    `;
    return Number(res?.[0]?.total ?? 0);
  }

  private async sumManualExpenses(fromDate: Date, toDate: Date, companyIds?: number[]) {
    const ids = this.normalizeCompanyIds(companyIds);
    if (ids == null) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(fe."amount"), 0) AS "total"
        FROM "FinanceEntry" fe
        WHERE fe."type" = 'EXPENSE'
          AND fe."deletedAt" IS NULL
          AND fe."createdAt" >= ${fromDate}
          AND fe."createdAt" < ${toDate};
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    if (ids.length === 1) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(fe."amount"), 0) AS "total"
        FROM "FinanceEntry" fe
        LEFT JOIN "ExpenseCategory" ec ON ec.id = fe."categoryId"
        LEFT JOIN "User" u ON u.id = fe."userId"
        WHERE fe."type" = 'EXPENSE'
          AND fe."deletedAt" IS NULL
          AND fe."createdAt" >= ${fromDate}
          AND fe."createdAt" < ${toDate}
          AND (
            (fe."categoryId" IS NOT NULL AND ec."companyId" = ${ids[0]})
            OR (fe."categoryId" IS NULL AND u."companyId" = ${ids[0]})
            OR (fe."categoryId" IS NULL AND u."companyId" IS NULL)
          );
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(fe."amount"), 0) AS "total"
      FROM "FinanceEntry" fe
      LEFT JOIN "ExpenseCategory" ec ON ec.id = fe."categoryId"
      LEFT JOIN "User" u ON u.id = fe."userId"
      WHERE fe."type" = 'EXPENSE'
        AND fe."deletedAt" IS NULL
        AND fe."createdAt" >= ${fromDate}
        AND fe."createdAt" < ${toDate}
        AND (
          (fe."categoryId" IS NOT NULL AND ec."companyId" IN (${Prisma.join(ids)}))
          OR (fe."categoryId" IS NULL AND u."companyId" IN (${Prisma.join(ids)}))
        );
    `;
    return Number(res?.[0]?.total ?? 0);
  }

  private periodSnapshot({
    purchases,
    manualExpenses,
    sales,
    previousBalance,
  }: {
    purchases: number;
    manualExpenses: number;
    sales: number;
    /** Résultat net de la période précédente (même formule : ventes − achats − dépenses). */
    previousBalance: number;
  }) {
    const totalOutflows = purchases + manualExpenses;
    /** Revenus (ventes) moins sorties d’argent (achats reçus + dépenses manuelles). */
    const balance = sales - totalOutflows;
    const deficit = balance < 0 ? Math.abs(balance) : 0;
    let trend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (balance > previousBalance) trend = 'UP';
    else if (balance < previousBalance) trend = 'DOWN';

    const trendPct =
      previousBalance === 0
        ? null
        : ((balance - previousBalance) / Math.abs(previousBalance)) * 100;

    return {
      purchases,
      manualExpenses,
      sales,
      totalOutflows,
      balance,
      deficit,
      trend,
      trendPct,
    };
  }

  async dashboardSummary(companyIds?: number[]) {
    const now = new Date();
    const { from: dayStart } = businessPeriodBounds('day', now);
    const { from: weekStart } = businessPeriodBounds('week', now);
    const { from: monthStart } = businessPeriodBounds('month', now);

    const todayYmd = nowBusinessYmd(now);
    const prevDayStart = ymdToBusinessDayStart(shiftBusinessYmd(todayYmd, -1));
    const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [yy, mm] = todayYmd.split('-').map(Number);
    const prevMonth = mm === 1 ? 12 : mm - 1;
    const prevYear = mm === 1 ? yy - 1 : yy;
    const prevMonthStart = ymdToBusinessDayStart(
      `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`,
    );

    const [day, week, month] = await Promise.all([
      (async () => {
        const [purchases, manualExpenses, sales] = await Promise.all([
          this.sumPurchasesReceived(dayStart, now, companyIds),
          this.sumManualExpenses(dayStart, now, companyIds),
          this.sumSales(dayStart, now, companyIds),
        ]);
        const previousBalance = (await Promise.all([
          this.sumPurchasesReceived(prevDayStart, dayStart, companyIds),
          this.sumManualExpenses(prevDayStart, dayStart, companyIds),
          this.sumSales(prevDayStart, dayStart, companyIds),
        ]).then(([pp, me, s]) => s - pp - me));

        return this.periodSnapshot({ purchases, manualExpenses, sales, previousBalance });
      })(),
      (async () => {
        const [purchases, manualExpenses, sales] = await Promise.all([
          this.sumPurchasesReceived(weekStart, now, companyIds),
          this.sumManualExpenses(weekStart, now, companyIds),
          this.sumSales(weekStart, now, companyIds),
        ]);
        const previousBalance = (await Promise.all([
          this.sumPurchasesReceived(prevWeekStart, weekStart, companyIds),
          this.sumManualExpenses(prevWeekStart, weekStart, companyIds),
          this.sumSales(prevWeekStart, weekStart, companyIds),
        ]).then(([pp, me, s]) => s - pp - me));

        return this.periodSnapshot({ purchases, manualExpenses, sales, previousBalance });
      })(),
      (async () => {
        const [purchases, manualExpenses, sales] = await Promise.all([
          this.sumPurchasesReceived(monthStart, now, companyIds),
          this.sumManualExpenses(monthStart, now, companyIds),
          this.sumSales(monthStart, now, companyIds),
        ]);
        const previousBalance = (await Promise.all([
          this.sumPurchasesReceived(prevMonthStart, monthStart, companyIds),
          this.sumManualExpenses(prevMonthStart, monthStart, companyIds),
          this.sumSales(prevMonthStart, monthStart, companyIds),
        ]).then(([pp, me, s]) => s - pp - me));

        return this.periodSnapshot({ purchases, manualExpenses, sales, previousBalance });
      })(),
    ]);

    return { day, week, month };
  }

  /**
   * Résumé financier sur une plage [dateFrom, dateTo] (jours calendaires inclusifs).
   * Achats / ventes peuvent être filtrés par département ; les dépenses manuelles restent au périmètre entreprise.
   */
  async dashboardSummaryRange(
    dateFrom: string,
    dateTo: string,
    companyIds?: number[],
    departmentId?: number,
  ) {
    const from = this.ymdToDateStart(dateFrom);
    const to = this.ymdToDateEnd(dateTo);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('dateFrom doit être antérieure ou égale à dateTo');
    }
    const [purchases, manualExpenses, sales] = await Promise.all([
      this.sumPurchasesForRange(from, to, companyIds, departmentId),
      this.sumManualExpensesForRange(from, to, companyIds),
      this.sumSalesForRange(from, to, companyIds, departmentId),
    ]);
    const totalOutflows = purchases + manualExpenses;
    const balance = sales - totalOutflows;
    return {
      purchases,
      manualExpenses,
      sales,
      totalOutflows,
      balance,
      deficit: balance < 0 ? Math.abs(balance) : 0,
      trend: 'FLAT' as const,
      trendPct: null as number | null,
    };
  }

  private async sumSalesForRange(
    from: Date,
    to: Date,
    companyIds?: number[],
    departmentId?: number,
  ) {
    const ids = this.normalizeCompanyIds(companyIds);
    const deptFilter =
      departmentId != null && departmentId > 0
        ? Prisma.sql`AND p."departmentId" = ${departmentId}`
        : Prisma.empty;

    if (ids == null) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(si."subtotal"), 0) AS "total"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        JOIN "Product" p ON p.id = si."productId"
        WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL
          AND s."createdAt" >= ${from}
          AND s."createdAt" <= ${to}
          ${deptFilter}
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    if (ids.length === 1) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(si."subtotal"), 0) AS "total"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        JOIN "Product" p ON p.id = si."productId"
        WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL
          AND p."companyId" = ${ids[0]}
          AND s."createdAt" >= ${from}
          AND s."createdAt" <= ${to}
          ${deptFilter}
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(si."subtotal"), 0) AS "total"
      FROM "SaleItem" si
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Product" p ON p.id = si."productId"
      WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL
        AND p."companyId" IN (${Prisma.join(ids)})
        AND s."createdAt" >= ${from}
        AND s."createdAt" <= ${to}
        ${deptFilter}
    `;
    return Number(res?.[0]?.total ?? 0);
  }

  private async sumPurchasesForRange(
    from: Date,
    to: Date,
    companyIds?: number[],
    departmentId?: number,
  ) {
    const ids = this.normalizeCompanyIds(companyIds);
    const deptFilter =
      departmentId != null && departmentId > 0
        ? Prisma.sql`AND gr."departmentId" = ${departmentId}`
        : Prisma.empty;

    if (ids == null) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(grl."quantity" * grl."unitCost"), 0) AS "total"
        FROM "GoodsReceiptLine" grl
        JOIN "GoodsReceipt" gr ON gr.id = grl."goodsReceiptId"
        WHERE gr."status" = 'POSTED'
          AND gr."deletedAt" IS NULL
          AND gr."receivedAt" >= ${from}
          AND gr."receivedAt" <= ${to}
          ${deptFilter}
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    if (ids.length === 1) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(grl."quantity" * grl."unitCost"), 0) AS "total"
        FROM "GoodsReceiptLine" grl
        JOIN "GoodsReceipt" gr ON gr.id = grl."goodsReceiptId"
        JOIN "Department" d ON d.id = gr."departmentId"
        WHERE gr."status" = 'POSTED'
          AND gr."deletedAt" IS NULL
          AND d."companyId" = ${ids[0]}
          AND gr."receivedAt" >= ${from}
          AND gr."receivedAt" <= ${to}
          ${deptFilter}
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(grl."quantity" * grl."unitCost"), 0) AS "total"
      FROM "GoodsReceiptLine" grl
      JOIN "GoodsReceipt" gr ON gr.id = grl."goodsReceiptId"
      JOIN "Department" d ON d.id = gr."departmentId"
      WHERE gr."status" = 'POSTED'
        AND gr."deletedAt" IS NULL
        AND d."companyId" IN (${Prisma.join(ids)})
        AND gr."receivedAt" >= ${from}
        AND gr."receivedAt" <= ${to}
        ${deptFilter}
    `;
    return Number(res?.[0]?.total ?? 0);
  }

  private async sumManualExpensesForRange(from: Date, to: Date, companyIds?: number[]) {
    const ids = this.normalizeCompanyIds(companyIds);
    if (ids == null) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(fe."amount"), 0) AS "total"
        FROM "FinanceEntry" fe
        WHERE fe."type" = 'EXPENSE'
          AND fe."deletedAt" IS NULL
          AND fe."createdAt" >= ${from}
          AND fe."createdAt" <= ${to}
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    if (ids.length === 1) {
      const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(SUM(fe."amount"), 0) AS "total"
        FROM "FinanceEntry" fe
        LEFT JOIN "ExpenseCategory" ec ON ec.id = fe."categoryId"
        LEFT JOIN "User" u ON u.id = fe."userId"
        WHERE fe."type" = 'EXPENSE'
          AND fe."deletedAt" IS NULL
          AND fe."createdAt" >= ${from}
          AND fe."createdAt" <= ${to}
          AND (
            (fe."categoryId" IS NOT NULL AND ec."companyId" = ${ids[0]})
            OR (fe."categoryId" IS NULL AND u."companyId" = ${ids[0]})
            OR (fe."categoryId" IS NULL AND u."companyId" IS NULL)
          );
      `;
      return Number(res?.[0]?.total ?? 0);
    }

    const res = await this.prisma.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM(fe."amount"), 0) AS "total"
      FROM "FinanceEntry" fe
      LEFT JOIN "ExpenseCategory" ec ON ec.id = fe."categoryId"
      LEFT JOIN "User" u ON u.id = fe."userId"
      WHERE fe."type" = 'EXPENSE'
        AND fe."deletedAt" IS NULL
        AND fe."createdAt" >= ${from}
        AND fe."createdAt" <= ${to}
        AND (
          (fe."categoryId" IS NOT NULL AND ec."companyId" IN (${Prisma.join(ids)}))
          OR (fe."categoryId" IS NULL AND u."companyId" IN (${Prisma.join(ids)}))
        );
    `;
    return Number(res?.[0]?.total ?? 0);
  }

  /** Bornes de date alignées sur le tableau de bord (jour / 7 jours / mois en cours, Haïti). */
  private dashboardPeriodBounds(period: 'day' | 'week' | 'month'): { from: Date; to: Date } {
    return businessPeriodBounds(period);
  }

  private ymdToDateStart(ymd: string): Date {
    try {
      return ymdToBusinessDayStart(ymd);
    } catch {
      throw new BadRequestException('dateFrom/dateTo attendues au format YYYY-MM-DD');
    }
  }

  private ymdToDateEnd(ymd: string): Date {
    try {
      return ymdToBusinessDayEnd(ymd);
    } catch {
      throw new BadRequestException('dateFrom/dateTo attendues au format YYYY-MM-DD');
    }
  }

  private resolveSalesByProductRange(opts: {
    period?: 'day' | 'week' | 'month';
    dateFrom?: string;
    dateTo?: string;
  }): { from: Date; to: Date } {
    if (opts.dateFrom?.trim() && opts.dateTo?.trim()) {
      const from = this.ymdToDateStart(opts.dateFrom);
      const to = this.ymdToDateEnd(opts.dateTo);
      if (from.getTime() > to.getTime()) {
        throw new BadRequestException('dateFrom doit être antérieure ou égale à dateTo');
      }
      return { from, to };
    }
    const period = opts.period ?? 'month';
    return this.dashboardPeriodBounds(period);
  }

  /**
   * Total vendu par produit ou service sur la période, pour une entreprise :
   * tri par département puis par nom de produit (produits sans département en dernier).
   */
  async dashboardSalesByProduct(
    companyIds: number[] | undefined,
    opts: {
      period?: 'day' | 'week' | 'month';
      dateFrom?: string;
      dateTo?: string;
      departmentId?: number;
    },
  ) {
    const { from, to } = this.resolveSalesByProductRange(opts);
    return this.querySalesByProduct(from, to, companyIds, opts.departmentId);
  }

  private async querySalesByProduct(
    from: Date,
    to: Date,
    companyIds?: number[],
    departmentId?: number,
  ) {
    const ids = this.normalizeCompanyIds(companyIds);
    const deptFilter =
      departmentId != null && departmentId > 0
        ? Prisma.sql`AND p."departmentId" = ${departmentId}`
        : Prisma.empty;

    type Row = {
      companyId: number | null;
      companyName: string | null;
      departmentId: number | null;
      departmentName: string | null;
      productId: number;
      productName: string;
      isService: boolean;
      quantity: string;
      totalSubtotal: string;
    };

    let rows: Row[];

    if (ids == null) {
      rows = await this.prisma.$queryRaw<Row[]>`
        SELECT
          p."companyId" AS "companyId",
          c."name" AS "companyName",
          p."departmentId" AS "departmentId",
          d."name" AS "departmentName",
          p."id" AS "productId",
          p."name" AS "productName",
          p."isService" AS "isService",
          COALESCE(SUM(si."baseQuantity"), 0)::text AS "quantity",
          COALESCE(SUM(si."subtotal"), 0)::text AS "totalSubtotal"
        FROM "SaleItem" si
        INNER JOIN "Sale" s ON s.id = si."saleId"
        INNER JOIN "Product" p ON p.id = si."productId"
        LEFT JOIN "Department" d ON d.id = p."departmentId"
        LEFT JOIN "Company" c ON c.id = p."companyId"
        WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL
          AND s."createdAt" >= ${from}
          AND s."createdAt" <= ${to}
          ${deptFilter}
        GROUP BY p."id", p."name", p."isService", p."companyId", c."name", p."departmentId", d."name"
        ORDER BY c."name" NULLS LAST, d."name" NULLS LAST, p."name" ASC
      `;
    } else if (ids.length === 1) {
      rows = await this.prisma.$queryRaw<Row[]>`
        SELECT
          p."companyId" AS "companyId",
          c."name" AS "companyName",
          p."departmentId" AS "departmentId",
          d."name" AS "departmentName",
          p."id" AS "productId",
          p."name" AS "productName",
          p."isService" AS "isService",
          COALESCE(SUM(si."baseQuantity"), 0)::text AS "quantity",
          COALESCE(SUM(si."subtotal"), 0)::text AS "totalSubtotal"
        FROM "SaleItem" si
        INNER JOIN "Sale" s ON s.id = si."saleId"
        INNER JOIN "Product" p ON p.id = si."productId"
        LEFT JOIN "Department" d ON d.id = p."departmentId"
        LEFT JOIN "Company" c ON c.id = p."companyId"
        WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL
          AND p."companyId" = ${ids[0]}
          AND s."createdAt" >= ${from}
          AND s."createdAt" <= ${to}
          ${deptFilter}
        GROUP BY p."id", p."name", p."isService", p."companyId", c."name", p."departmentId", d."name"
        ORDER BY d."name" NULLS LAST, p."name" ASC
      `;
    } else {
      rows = await this.prisma.$queryRaw<Row[]>`
        SELECT
          p."companyId" AS "companyId",
          c."name" AS "companyName",
          p."departmentId" AS "departmentId",
          d."name" AS "departmentName",
          p."id" AS "productId",
          p."name" AS "productName",
          p."isService" AS "isService",
          COALESCE(SUM(si."baseQuantity"), 0)::text AS "quantity",
          COALESCE(SUM(si."subtotal"), 0)::text AS "totalSubtotal"
        FROM "SaleItem" si
        INNER JOIN "Sale" s ON s.id = si."saleId"
        INNER JOIN "Product" p ON p.id = si."productId"
        LEFT JOIN "Department" d ON d.id = p."departmentId"
        LEFT JOIN "Company" c ON c.id = p."companyId"
        WHERE s."status" = 'COMPLETED' AND s."deletedAt" IS NULL
          AND p."companyId" IN (${Prisma.join(ids)})
          AND s."createdAt" >= ${from}
          AND s."createdAt" <= ${to}
          ${deptFilter}
        GROUP BY p."id", p."name", p."isService", p."companyId", c."name", p."departmentId", d."name"
        ORDER BY c."name" NULLS LAST, d."name" NULLS LAST, p."name" ASC
      `;
    }

    return rows.map((r) => ({
      companyId: r.companyId,
      companyName: r.companyName,
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      productId: r.productId,
      productName: r.productName,
      isService: r.isService,
      quantity: Number(r.quantity),
      totalSubtotal: Number(r.totalSubtotal),
    }));
  }

  async buildSalesByProductPdf(
    companyId: number,
    opts: {
      period?: 'day' | 'week' | 'month';
      dateFrom?: string;
      dateTo?: string;
      departmentId?: number;
    },
  ): Promise<Buffer> {
    const { from, to } = this.resolveSalesByProductRange(opts);
    const [company, rows] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, logoUrl: true },
      }),
      this.querySalesByProduct(from, to, [companyId], opts.departmentId),
    ]);
    if (!company) {
      throw new BadRequestException('Entreprise introuvable');
    }

    const {
      collectPdfBuffer,
      createPdfDoc,
      drawKeyValueBlock,
      drawReportHeader,
      drawSectionTitle,
      drawTableHeader,
      drawTableRow,
      generatedMetaLine,
    } = await import('../../common/pdf/pdf-document');
    const { formatDateFr, formatDateTimeFr, formatMoneyHtg, formatQty } = await import(
      '../../common/pdf/pdf-format'
    );

    const periodLabel =
      opts.dateFrom?.trim() && opts.dateTo?.trim()
        ? `${formatDateFr(opts.dateFrom.trim())} → ${formatDateFr(opts.dateTo.trim())}`
        : `période ${opts.period ?? 'month'}`;

    const doc = createPdfDoc();
    await drawReportHeader(doc, {
      title: 'Ventes par produit / service',
      brand: { companyName: company.name, logoUrl: company.logoUrl },
      metaLines: [
        `Période : ${periodLabel} (${formatDateTimeFr(from)} — ${formatDateTimeFr(to)})`,
        generatedMetaLine(),
      ],
    });

    if (rows.length === 0) {
      doc.fontSize(11).fillColor('#64748b').text('Aucune ligne sur cette période.');
    } else {
      type Row = (typeof rows)[number];
      const groups: { key: string; label: string; items: Row[] }[] = [];
      for (const r of rows) {
        const label = r.departmentName?.trim() || 'Sans département';
        const key = String(r.departmentId ?? 'none');
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.items.push(r);
        else groups.push({ key, label, items: [r] });
      }

      const cols = [
        { key: 'name', label: 'Article', width: 220 },
        { key: 'type', label: 'Type', width: 70 },
        { key: 'qty', label: 'Qté', width: 70, align: 'right' as const },
        { key: 'total', label: 'Montant', width: 150, align: 'right' as const },
      ];

      let grand = 0;
      for (const g of groups) {
        drawSectionTitle(doc, g.label);
        drawTableHeader(doc, cols);
        let sub = 0;
        g.items.forEach((r, i) => {
          drawTableRow(
            doc,
            cols,
            {
              name: r.productName,
              type: r.isService ? 'Service' : 'Produit',
              qty: formatQty(r.quantity),
              total: formatMoneyHtg(r.totalSubtotal),
            },
            { alt: i % 2 === 1 },
          );
          sub += r.totalSubtotal;
          grand += r.totalSubtotal;
        });
        doc.moveDown(0.2);
        drawKeyValueBlock(doc, [
          { label: `Sous-total ${g.label}`, value: formatMoneyHtg(sub) },
        ]);
        doc.moveDown(0.35);
      }
      drawKeyValueBlock(doc, [{ label: 'TOTAL', value: formatMoneyHtg(grand), emphasize: true }]);
    }

    return collectPdfBuffer(doc);
  }

  /**
   * PDF de synthèse financière (CA, sorties, résultat, top produits) pour une plage calendaire.
   */
  async buildFinancialSynthesisPdf(
    dateFrom: string,
    dateTo: string,
    companyIds?: number[],
    departmentId?: number,
  ): Promise<Buffer> {
    const from = this.ymdToDateStart(dateFrom);
    const to = this.ymdToDateEnd(dateTo);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('dateFrom doit être antérieure ou égale à dateTo');
    }

    const ids = this.normalizeCompanyIds(companyIds);
    const [companies, snap, rows, dept] = await Promise.all([
      ids == null
        ? this.prisma.company.findMany({
            where: { deletedAt: null },
            select: { name: true, logoUrl: true },
            orderBy: { name: 'asc' },
          })
        : this.prisma.company.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { name: true, logoUrl: true },
            orderBy: { name: 'asc' },
          }),
      this.dashboardSummaryRange(dateFrom.trim(), dateTo.trim(), companyIds, departmentId),
      this.querySalesByProduct(from, to, companyIds, departmentId),
      departmentId != null && departmentId > 0
        ? this.prisma.department.findUnique({
            where: { id: departmentId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    if (ids != null && companies.length === 0) {
      throw new BadRequestException('Entreprise introuvable');
    }

    const {
      collectPdfBuffer,
      createPdfDoc,
      drawFooterNote,
      drawKeyValueBlock,
      drawReportHeader,
      drawSectionTitle,
      drawTableHeader,
      drawTableRow,
      generatedMetaLine,
    } = await import('../../common/pdf/pdf-document');
    const { formatDateFr, formatMoneyHtg, formatQty } = await import('../../common/pdf/pdf-format');

    const brandName =
      companies.length === 1
        ? companies[0].name
        : companies.length > 1
          ? companies.map((c) => c.name).join(', ')
          : 'POS Frères Baziles';
    const logoUrl = companies.length === 1 ? companies[0].logoUrl : null;
    const deptLine =
      departmentId != null && departmentId > 0
        ? `Département : ${dept?.name?.trim() || `#${departmentId}`}`
        : 'Département : tous';

    const doc = createPdfDoc();
    await drawReportHeader(doc, {
      title: 'Synthèse financière',
      brand: { companyName: brandName, logoUrl },
      metaLines: [
        `Période : ${formatDateFr(dateFrom.trim())} → ${formatDateFr(dateTo.trim())} (inclusif)`,
        deptLine,
        generatedMetaLine(),
      ],
    });

    drawSectionTitle(doc, 'Indicateurs');
    drawKeyValueBlock(doc, [
      { label: 'Chiffre d’affaires (ventes)', value: formatMoneyHtg(snap.sales) },
      { label: 'Achats reçus', value: formatMoneyHtg(snap.purchases) },
      { label: 'Dépenses manuelles', value: formatMoneyHtg(snap.manualExpenses) },
      { label: 'Total sorties', value: formatMoneyHtg(snap.totalOutflows) },
      { label: 'Résultat net', value: formatMoneyHtg(snap.balance), emphasize: true },
    ]);

    doc.moveDown(0.45);
    drawSectionTitle(doc, 'Top 25 articles par unités vendues');
    const sorted = [...rows].sort((a, b) => b.quantity - a.quantity).slice(0, 25);
    if (sorted.length === 0) {
      doc.fontSize(10).fillColor('#64748b').text('Aucune vente sur cette période.');
    } else {
      const cols = [
        { key: 'name', label: 'Article', width: 220 },
        { key: 'type', label: 'Type', width: 70 },
        { key: 'qty', label: 'Qté', width: 70, align: 'right' as const },
        { key: 'total', label: 'Montant', width: 150, align: 'right' as const },
      ];
      drawTableHeader(doc, cols);
      let grand = 0;
      sorted.forEach((r, i) => {
        drawTableRow(
          doc,
          cols,
          {
            name: r.productName,
            type: r.isService ? 'Service' : 'Produit',
            qty: formatQty(r.quantity),
            total: formatMoneyHtg(r.totalSubtotal),
          },
          { alt: i % 2 === 1 },
        );
        grand += r.totalSubtotal;
      });
      doc.moveDown(0.25);
      drawKeyValueBlock(doc, [
        { label: 'Sous-total (lignes listées)', value: formatMoneyHtg(grand) },
      ]);
    }

    drawFooterNote(
      doc,
      'Les montants suivent les mêmes règles que le tableau de bord (ventes complétées, réceptions postées, dépenses saisies).',
    );

    return collectPdfBuffer(doc);
  }
}
