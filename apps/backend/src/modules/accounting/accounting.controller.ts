import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JournalCode } from '@prisma/client';
import { Response } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AccountingAssetsService } from './accounting-assets.service';
import { AccountingBackfillService } from './accounting-backfill.service';
import { AccountingReportsService } from './accounting-reports.service';
import { AccountingService } from './accounting.service';
import {
  BackfillAccountingDto,
  CreateAccountDto,
  CreateFiscalYearDto,
  CreateFixedAssetDto,
  CreateManualEntryDto,
  CreateSupplierPaymentDto,
  RunDepreciationDto,
  UpdateAccountDto,
} from './dto/accounting.dto';

@Controller('accounting')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly reports: AccountingReportsService,
    private readonly backfillService: AccountingBackfillService,
    private readonly assetsService: AccountingAssetsService,
  ) {}

  private parseCompanyId(raw?: string): number {
    const n = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestException('companyId requis');
    }
    return n;
  }

  private parseOptionalInt(raw?: string): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  @Get('overview')
  @Permissions('accounting.view')
  overview(@Query('companyId') companyIdRaw?: string) {
    return this.accounting.overview(this.parseCompanyId(companyIdRaw));
  }

  @Get('accounts')
  @Permissions('accounting.view')
  accounts(@Query('companyId') companyIdRaw?: string) {
    return this.accounting.listAccounts(this.parseCompanyId(companyIdRaw));
  }

  @Post('accounts/ensure')
  @Permissions('accounting.manage')
  ensureChart(@Body('companyId') companyId: number) {
    if (!companyId) throw new BadRequestException('companyId requis');
    return this.accounting.ensureChartOfAccounts(companyId);
  }

  @Post('accounts')
  @Permissions('accounting.manage')
  createAccount(@Body() dto: CreateAccountDto) {
    return this.accounting.createAccount(dto);
  }

  @Patch('accounts/:id')
  @Permissions('accounting.manage')
  updateAccount(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accounting.updateAccount(id, dto);
  }

  @Delete('accounts/:id')
  @Permissions('accounting.manage')
  removeAccount(@Param('id', ParseIntPipe) id: number) {
    return this.accounting.removeAccount(id);
  }

  @Get('fiscal-years')
  @Permissions('accounting.view')
  fiscalYears(@Query('companyId') companyIdRaw?: string) {
    return this.accounting.listFiscalYears(this.parseCompanyId(companyIdRaw));
  }

  @Post('fiscal-years')
  @Permissions('accounting.manage')
  createFiscalYear(
    @Body() dto: CreateFiscalYearDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.accounting.createFiscalYear(dto, user?.id);
  }

  @Post('fiscal-years/:id/close')
  @Permissions('accounting.manage')
  closeFiscalYear(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.accounting.closeFiscalYear(id, user?.id);
  }

  @Get('journal')
  @Permissions('accounting.view')
  journal(
    @Query('companyId') companyIdRaw?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('journalCode') journalCodeRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    const codes = ['VE', 'AC', 'BQ', 'CA', 'OD', 'AN'] as const;
    const journalCode = codes.includes(journalCodeRaw as (typeof codes)[number])
      ? (journalCodeRaw as JournalCode)
      : undefined;
    return this.accounting.listJournal({
      companyId: this.parseCompanyId(companyIdRaw),
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
      journalCode,
      skip: skipRaw ? Number.parseInt(skipRaw, 10) : undefined,
      take: takeRaw ? Number.parseInt(takeRaw, 10) : undefined,
    });
  }

  @Post('journal')
  @Permissions('accounting.write')
  createEntry(
    @Body() dto: CreateManualEntryDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.accounting.createManualEntry(dto, user?.id);
  }

  @Get('trial-balance')
  @Permissions('accounting.view')
  trialBalance(
    @Query('companyId') companyIdRaw?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reports.trialBalance({
      companyId: this.parseCompanyId(companyIdRaw),
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
    });
  }

  @Get('general-ledger')
  @Permissions('accounting.view')
  generalLedger(
    @Query('companyId') companyIdRaw?: string,
    @Query('accountId') accountIdRaw?: string,
    @Query('accountCode') accountCode?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reports.generalLedger({
      companyId: this.parseCompanyId(companyIdRaw),
      accountId: this.parseOptionalInt(accountIdRaw),
      accountCode: accountCode?.trim() || undefined,
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
    });
  }

  @Get('balance-sheet')
  @Permissions('accounting.view')
  balanceSheet(
    @Query('companyId') companyIdRaw?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reports.balanceSheet({
      companyId: this.parseCompanyId(companyIdRaw),
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateTo: dateTo?.trim() || undefined,
    });
  }

  @Get('income-statement')
  @Permissions('accounting.view')
  incomeStatement(
    @Query('companyId') companyIdRaw?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reports.incomeStatement({
      companyId: this.parseCompanyId(companyIdRaw),
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
    });
  }

  private async sendPdf(res: Response, buffer: Buffer, filename: string) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('export/trial-balance/pdf')
  @Permissions('accounting.view')
  async exportTrialBalancePdf(
    @Res() res: Response,
    @Query('companyId') companyIdRaw?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const buf = await this.reports.exportTrialBalancePdf({
      companyId: this.parseCompanyId(companyIdRaw),
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
    });
    return this.sendPdf(res, buf, 'balance-generale.pdf');
  }

  @Get('export/balance-sheet/pdf')
  @Permissions('accounting.view')
  async exportBalanceSheetPdf(
    @Res() res: Response,
    @Query('companyId') companyIdRaw?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const buf = await this.reports.exportBalanceSheetPdf({
      companyId: this.parseCompanyId(companyIdRaw),
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateTo: dateTo?.trim() || undefined,
    });
    return this.sendPdf(res, buf, 'bilan.pdf');
  }

  @Get('export/income-statement/pdf')
  @Permissions('accounting.view')
  async exportIncomeStatementPdf(
    @Res() res: Response,
    @Query('companyId') companyIdRaw?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const buf = await this.reports.exportIncomeStatementPdf({
      companyId: this.parseCompanyId(companyIdRaw),
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
    });
    return this.sendPdf(res, buf, 'compte-de-resultat.pdf');
  }

  @Get('export/journal/pdf')
  @Permissions('accounting.view')
  async exportJournalPdf(
    @Res() res: Response,
    @Query('companyId') companyIdRaw?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const buf = await this.reports.exportJournalPdf({
      companyId: this.parseCompanyId(companyIdRaw),
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
    });
    return this.sendPdf(res, buf, 'journal-comptable.pdf');
  }

  @Get('export/general-ledger/pdf')
  @Permissions('accounting.view')
  async exportGeneralLedgerPdf(
    @Res() res: Response,
    @Query('companyId') companyIdRaw?: string,
    @Query('accountId') accountIdRaw?: string,
    @Query('accountCode') accountCode?: string,
    @Query('fiscalYearId') fiscalYearIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const buf = await this.reports.exportGeneralLedgerPdf({
      companyId: this.parseCompanyId(companyIdRaw),
      accountId: this.parseOptionalInt(accountIdRaw),
      accountCode: accountCode?.trim() || undefined,
      fiscalYearId: this.parseOptionalInt(fiscalYearIdRaw),
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
    });
    return this.sendPdf(res, buf, 'grand-livre.pdf');
  }

  @Post('backfill')
  @Permissions('accounting.manage')
  backfill(
    @Body() dto: BackfillAccountingDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.backfillService.backfill(dto.companyId, user?.id);
  }

  @Get('suppliers')
  @Permissions('accounting.view')
  suppliers(@Query('companyId') companyIdRaw?: string) {
    return this.assetsService.suppliersOverview(this.parseCompanyId(companyIdRaw));
  }

  @Post('suppliers/payments')
  @Permissions('accounting.write')
  createSupplierPayment(
    @Body() dto: CreateSupplierPaymentDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.assetsService.createSupplierPayment(dto, user?.id);
  }

  @Get('fixed-assets')
  @Permissions('accounting.view')
  fixedAssets(@Query('companyId') companyIdRaw?: string) {
    return this.assetsService.listFixedAssets(this.parseCompanyId(companyIdRaw));
  }

  @Post('fixed-assets')
  @Permissions('accounting.write')
  createFixedAsset(
    @Body() dto: CreateFixedAssetDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.assetsService.createFixedAsset(dto, user?.id);
  }

  @Post('fixed-assets/depreciate')
  @Permissions('accounting.manage')
  runDepreciation(
    @Body() dto: RunDepreciationDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.assetsService.runDepreciation(dto, user?.id);
  }
}
