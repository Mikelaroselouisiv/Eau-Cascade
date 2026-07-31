import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RolesModule } from '../roles/roles.module';
import { SalesController } from './sales.controller';
import { SalesRepository } from './sales.repository';
import { SalesService } from './sales.service';

@Module({
  imports: [InventoryModule, AuditModule, DeliveriesModule, RolesModule],
  controllers: [SalesController],
  providers: [SalesService, SalesRepository],
  exports: [SalesService],
})
export class SalesModule {}
