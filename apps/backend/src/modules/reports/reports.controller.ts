import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { formatFilenameDate } from '../../common/pdf/pdf-format';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('revenue')
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
  revenue() {
    return this.reportsService.revenue();
  }

  @Get('top-products')
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
  topProducts() {
    return this.reportsService.topProducts();
  }

  @Get('sales-by-cashier')
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
  salesByCashier() {
    return this.reportsService.salesByCashier();
  }

  @Get('margin')
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
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
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
  dashboardSummary(
    @Query('companyId') companyIdRaw?: string,
    @Query('companyIds') companyIdsRaw?: string,
  ) {
    const companyIds = this.reportsService.parseCompanyIdsQuery(companyIdsRaw, companyIdRaw);
    return this.reportsService.dashboardSummary(companyIds);
  }

  @Get('dashboard-summary-range')
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
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
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
  async exportDashboardSalesByProductPdf(
    @Res() res: Response,
    @Query('companyId') companyIdRaw: string,
    @Query('period') periodRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : NaN;
    if (!Number.isFinite(companyId) || companyId <= 0) {
      throw new BadRequestException('companyId requis et valide');
    }
    const period: 'day' | 'week' | 'month' =
      periodRaw === 'day' || periodRaw === 'week' || periodRaw === 'month' ? periodRaw : 'month';
    const departmentIdN = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : NaN;
    const departmentId =
      Number.isFinite(departmentIdN) && (departmentIdN as number) > 0 ? (departmentIdN as number) : undefined;
    const opts =
      dateFrom?.trim() && dateTo?.trim()
        ? { dateFrom: dateFrom.trim(), dateTo: dateTo.trim(), ...(departmentId != null ? { departmentId } : {}) }
        : { period, ...(departmentId != null ? { departmentId } : {}) };
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
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
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
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
  dashboardSalesByProduct(
    @Query('period') periodRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('companyId') companyIdRaw?: string,
    @Query('companyIds') companyIdsRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    const companyIds = this.reportsService.parseCompanyIdsQuery(companyIdsRaw, companyIdRaw);
    const period: 'day' | 'week' | 'month' =
      periodRaw === 'day' || periodRaw === 'week' || periodRaw === 'month' ? periodRaw : 'month';
    const departmentIdN = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : NaN;
    const departmentId =
      Number.isFinite(departmentIdN) && (departmentIdN as number) > 0 ? (departmentIdN as number) : undefined;
    if (dateFrom?.trim() && dateTo?.trim()) {
      return this.reportsService.dashboardSalesByProduct(companyIds, {
        dateFrom: dateFrom.trim(),
        dateTo: dateTo.trim(),
        ...(departmentId != null ? { departmentId } : {}),
      });
    }
    return this.reportsService.dashboardSalesByProduct(companyIds, {
      period,
      ...(departmentId != null ? { departmentId } : {}),
    });
  }
}
