import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccountingAssetsService } from './accounting-assets.service';
import { AccountingBackfillService } from './accounting-backfill.service';
import { AccountingController } from './accounting.controller';
import { AccountingPostingService } from './accounting-posting.service';
import { AccountingReportsService } from './accounting-reports.service';
import { AccountingService } from './accounting.service';

@Module({
  imports: [AuditModule],
  controllers: [AccountingController],
  providers: [
    AccountingService,
    AccountingPostingService,
    AccountingReportsService,
    AccountingBackfillService,
    AccountingAssetsService,
  ],
  exports: [AccountingService, AccountingPostingService, AccountingReportsService],
})
export class AccountingModule {}
