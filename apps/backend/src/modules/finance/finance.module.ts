import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AuditModule } from '../audit/audit.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { SalesModule } from '../sales/sales.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [AuditModule, PurchasingModule, SalesModule, AccountingModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
