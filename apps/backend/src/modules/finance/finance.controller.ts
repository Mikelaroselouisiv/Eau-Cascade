import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FinanceType } from '@prisma/client';
import { Response } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { formatDateFr } from '../../common/pdf/pdf-format';
import { mergePlantCashierPermissions } from '../../common/plant-cashier';
import { permissionsSatisfy } from '../../common/permissions';
import { clampToRecentTotalsRange, mustClampRecentExpenses } from '../../common/utils/recent-range';
import { RolesService } from '../roles/roles.service';
import { CloseCashDto, CreateFinanceEntryDto } from './dto/finance-entry.dto';
import { FinanceLedgerNature, FinanceService } from './finance.service';

@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly rolesService: RolesService,
  ) {}

  private async resolveLedgerAccess(
    user: { role?: string } | undefined,
    dateFrom: string,
    dateTo: string,
    natureRaw?: string,
  ): Promise<{ dateFrom: string; dateTo: string; nature: FinanceLedgerNature }> {
    const perms = user?.role ? await this.rolesService.getPermissionsForUserRole(user.role) : [];
    const fullHistory =
      permissionsSatisfy(perms, ['finance.view']) || permissionsSatisfy(perms, ['finance.write']);
    const range = mustClampRecentExpenses(perms)
      ? clampToRecentTotalsRange(dateFrom, dateTo)
      : { dateFrom: dateFrom.trim(), dateTo: dateTo.trim() };
    const allowed: FinanceLedgerNature[] = ['all', 'purchase', 'sale', 'expense'];
    let nature = (allowed.includes(natureRaw as FinanceLedgerNature)
      ? natureRaw
      : 'all') as FinanceLedgerNature;
    if (!fullHistory) nature = 'expense';
    return { ...range, nature };
  }

  @Get('journal')
  @Permissions('finance.view')
  journal(
    @Query('companyId') companyIdRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    const parseIntOr = (raw: string | undefined) => {
      if (raw === undefined || raw === '') return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    return this.financeService.journal({
      companyId: parseIntOr(companyIdRaw),
      skip: skipRaw ? Number.parseInt(skipRaw, 10) : undefined,
      take: takeRaw ? Number.parseInt(takeRaw, 10) : undefined,
    });
  }

  @Get('ledger')
  @PermissionsAny('finance.view', 'finance.recent_expenses')
  async ledger(
    @Query('companyId') companyIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('nature') natureRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('take') takeRaw?: string,
    @GetUser() user?: { role?: string },
  ) {
    const parseIntOr = (raw: string | undefined) => {
      if (raw === undefined || raw === '') return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const companyId = parseIntOr(companyIdRaw);
    if (companyId == null) {
      throw new BadRequestException('companyId requis');
    }
    if (!dateFrom?.trim() || !dateTo?.trim()) {
      throw new BadRequestException('dateFrom et dateTo requis');
    }
    const access = await this.resolveLedgerAccess(user, dateFrom, dateTo, natureRaw);
    return this.financeService.ledger({
      companyId,
      dateFrom: access.dateFrom,
      dateTo: access.dateTo,
      nature: access.nature,
      skip: skipRaw ? Number.parseInt(skipRaw, 10) : undefined,
      take: takeRaw ? Number.parseInt(takeRaw, 10) : undefined,
    });
  }

  @Get('ledger/export/pdf')
  @PermissionsAny('finance.view', 'finance.recent_expenses')
  async exportLedgerPdf(
    @Res() res: Response,
    @Query('companyId') companyIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('nature') natureRaw?: string,
    @GetUser() user?: { role?: string },
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : NaN;
    if (!Number.isFinite(companyId) || companyId <= 0) {
      throw new BadRequestException('companyId requis');
    }
    if (!dateFrom?.trim() || !dateTo?.trim()) {
      throw new BadRequestException('dateFrom et dateTo requis');
    }
    const access = await this.resolveLedgerAccess(user, dateFrom, dateTo, natureRaw);

    const pdfBuffer = await this.financeService.exportLedgerPdf({
      companyId,
      dateFrom: access.dateFrom,
      dateTo: access.dateTo,
      nature: access.nature,
    });
    const filenameDate = formatDateFr(new Date()).replace(/\//g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="journal_finance_${filenameDate}.pdf"`,
    );
    res.send(pdfBuffer);
  }

  @Post('entries')
  @PermissionsAny('finance.write', 'finance.expense')
  async createEntry(
    @Body() dto: CreateFinanceEntryDto,
    @GetUser()
    user?: { id?: number; role?: string; productionDepartmentIds?: number[] },
  ) {
    if (user?.role) {
      const rolePerms = await this.rolesService.getPermissionsForUserRole(user.role);
      const perms = mergePlantCashierPermissions(
        user.role,
        rolePerms,
        user.productionDepartmentIds,
      );
      const canFullWrite = permissionsSatisfy(perms, ['finance.write']);
      if (!canFullWrite && dto.type !== FinanceType.EXPENSE) {
        throw new ForbiddenException('Vous ne pouvez enregistrer que des dépenses.');
      }
    }
    return this.financeService.createEntry(dto, user?.id, {
      role: user?.role,
      productionDepartmentIds: user?.productionDepartmentIds,
    });
  }

  @Post('cash-closure')
  @Permissions('finance.write')
  closeCash(@Body() dto: CloseCashDto, @GetUser() user?: { id?: number }) {
    return this.financeService.closeCash(dto, user?.id);
  }

  @Delete('ledger/:ledgerRowId')
  @Permissions('finance.write')
  deleteLedgerRow(
    @Param('ledgerRowId') ledgerRowId: string,
    @Query('companyId') companyIdRaw?: string,
    @GetUser() user?: { id?: number },
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : NaN;
    if (!Number.isFinite(companyId) || companyId <= 0) {
      throw new BadRequestException('companyId requis et valide');
    }
    return this.financeService.deleteLedgerRow(ledgerRowId, companyId, user?.id);
  }
}
