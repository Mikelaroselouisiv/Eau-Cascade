import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AuditModule } from '../audit/audit.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CreditController } from './credit.controller';
import { CreditService } from './credit.service';

@Module({
  imports: [PrismaModule, InventoryModule, AuditModule, DeliveriesModule, AccountingModule],
  controllers: [CreditController],
  providers: [CreditService],
  exports: [CreditService],
})
export class CreditModule {}
