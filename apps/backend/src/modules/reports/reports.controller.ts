import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { formatFilenameDate } from '../../common/pdf/pdf-format';
import {
  SALES_RECENT_TOTALS_DAYS,
  permissionsSatisfy,
} from '../../common/permissions';
import {
  nowBusinessYmd,
  shiftBusinessYmd,
} from '../../common/utils/business-timezone';
import { RolesService } from '../roles/roles.service';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly rolesService: RolesService,
  ) {}

  /**
   * `reports.view` = historique libre.
   * `sales.recent_totals` seul = fenêtre des N derniers jours métier (aujourd’hui + veille).
   */
  private async resolveSalesByProductRange(
    role: string | undefined,
    dateFrom?: string,
    dateTo?: string,
    periodRaw?: string,
  ): Promise<{ dateFrom: string; dateTo: string } | { period: 'day' | 'week' | 'month' }> {
    const perms = role ? await this.rolesService.getPermissionsForUserRole(role) : [];
    const fullHistory = permissionsSatisfy(perms, ['reports.view']);
    const recentOnly =
      !fullHistory && permissionsSatisfy(perms, ['sales.recent_totals']);

    if (recentOnly) {
      const today = nowBusinessYmd();
      const minFrom = shiftBusinessYmd(today, -(SALES_RECENT_TOTALS_DAYS - 1));
      let from = dateFrom?.trim() || minFrom;
      let to = dateTo?.trim() || today;
      if (from < minFrom) from = minFrom;
      if (to > today) to = today;
      if (to < from) to = from;
      if (from > today) from = minFrom;
      return { dateFrom: from, dateTo: to };
    }

    if (dateFrom?.trim() && dateTo?.trim()) {
      return { dateFrom: dateFrom.trim(), dateTo: dateTo.trim() };
    }
    const period: 'day' | 'week' | 'month' =
      periodRaw === 'day' || periodRaw === 'week' || periodRaw === 'month' ? periodRaw : 'month';
    return { period };
  }

  @Get('revenue')
  @Permissions('reports.view')
  revenue() {
    return this.reportsService.revenue();
  }

  @Get('top-products')
  @Permissions('reports.view')
  topProducts() {
    return this.reportsService.topProducts();
  }

  @Get('sales-by-cashier')
  @Permissions('reports.view')
  salesByCashier() {
    return this.reportsService.salesByCashier();
  }

  @Get('margin')
  @Permissions('reports.view')
  margin(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('companyId') companyIdRaw?: string,
    @Query('companyIds') companyIdsRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    if (dateFrom?.trim() && dateTo?.trim()) {
      const companyIds = this.reportsService.parseCompanyIdsQuery(companyIdsRaw, companyIdRaw);
      const departmentIdN = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : NaN;
      const departmentId =
        Number.isFinite(departmentIdN) && departmentIdN > 0 ? departmentIdN : undefined;
      return this.reportsService.marginAnalysis({
        dateFrom: dateFrom.trim(),
        dateTo: dateTo.trim(),
        companyIds,
        departmentId,
      });
    }
    return this.reportsService.margin();
  }

  @Get('dashboard-summary')
  @Permissions('reports.view')
  dashboardSummary(
    @Query('companyId') companyIdRaw?: string,
    @Query('companyIds') companyIdsRaw?: string,
  ) {
    const companyIds = this.reportsService.parseCompanyIdsQuery(companyIdsRaw, companyIdRaw);
    return this.reportsService.dashboardSummary(companyIds);
  }

  @Get('dashboard-summary-range')
  @Permissions('reports.view')
  dashboardSummaryRange(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('companyId') companyIdRaw?: string,
    @Query('companyIds') companyIdsRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    if (!dateFrom?.trim() || !dateTo?.trim()) {
      throw new BadRequestException('dateFrom et dateTo sont requis (YYYY-MM-DD)');
    }
    const companyIds = this.reportsService.parseCompanyIdsQuery(companyIdsRaw, companyIdRaw);
    const departmentIdN = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : NaN;
    const departmentId =
      Number.isFinite(departmentIdN) && (departmentIdN as number) > 0 ? (departmentIdN as number) : undefined;
    return this.reportsService.dashboardSummaryRange(
      dateFrom.trim(),
      dateTo.trim(),
      companyIds,
      departmentId,
    );
  }

  @Get('dashboard-sales-by-product/export/pdf')
  @PermissionsAny('reports.view', 'sales.recent_totals')
  async exportDashboardSalesByProductPdf(
    @Res() res: Response,
    @Query('companyId') companyIdRaw: string,
    @Query('period') periodRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('departmentId') departmentIdRaw?: string,
    @GetUser() user?: { role?: string },
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : NaN;
    if (!Number.isFinite(companyId) || companyId <= 0) {
      throw new BadRequestException('companyId requis et valide');
    }
    const departmentIdN = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : NaN;
    const departmentId =
      Number.isFinite(departmentIdN) && (departmentIdN as number) > 0 ? (departmentIdN as number) : undefined;
    const range = await this.resolveSalesByProductRange(user?.role, dateFrom, dateTo, periodRaw);
    const opts =
      'dateFrom' in range
        ? {
            dateFrom: range.dateFrom,
            dateTo: range.dateTo,
            ...(departmentId != null ? { departmentId } : {}),
          }
        : { period: range.period, ...(departmentId != null ? { departmentId } : {}) };
    const buffer = await this.reportsService.buildSalesByProductPdf(companyId, opts);
    const filenameDate = formatFilenameDate();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ventes-par-produit_${companyId}_${filenameDate}.pdf"`,
    );
    res.send(buffer);
  }

  @Get('dashboard-synthesis/export/pdf')
  @Permissions('reports.view')
  async exportFinancialSynthesisPdf(
    @Res() res: Response,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('companyId') companyIdRaw?: string,
    @Query('companyIds') companyIdsRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    if (!dateFrom?.trim() || !dateTo?.trim()) {
      throw new BadRequestException('dateFrom et dateTo sont requis (YYYY-MM-DD)');
    }
    const companyIds = this.reportsService.parseCompanyIdsQuery(companyIdsRaw, companyIdRaw);
    const departmentIdN = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : NaN;
    const departmentId =
      Number.isFinite(departmentIdN) && (departmentIdN as number) > 0 ? (departmentIdN as number) : undefined;
    const buffer = await this.reportsService.buildFinancialSynthesisPdf(
      dateFrom.trim(),
      dateTo.trim(),
      companyIds,
      departmentId,
    );
    const filenameDate = formatFilenameDate();
    const scope = companyIds?.length === 1 ? String(companyIds[0]) : companyIds?.length ? 'multi' : 'all';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="synthese-financiere_${scope}_${filenameDate}.pdf"`,
    );
    res.send(buffer);
  }

  @Get('dashboard-sales-by-product')
  @PermissionsAny('reports.view', 'sales.recent_totals')
  async dashboardSalesByProduct(
    @Query('period') periodRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('companyId') companyIdRaw?: string,
    @Query('companyIds') companyIdsRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
    @GetUser() user?: { role?: string },
  ) {
    const companyIds = this.reportsService.parseCompanyIdsQuery(companyIdsRaw, companyIdRaw);
    const departmentIdN = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : NaN;
    const departmentId =
      Number.isFinite(departmentIdN) && (departmentIdN as number) > 0 ? (departmentIdN as number) : undefined;
    const range = await this.resolveSalesByProductRange(user?.role, dateFrom, dateTo, periodRaw);
    if ('dateFrom' in range) {
      return this.reportsService.dashboardSalesByProduct(companyIds, {
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        ...(departmentId != null ? { departmentId } : {}),
      });
    }
    return this.reportsService.dashboardSalesByProduct(companyIds, {
      period: range.period,
      ...(departmentId != null ? { departmentId } : {}),
    });
  }
}
