import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionSessionsController } from './production-sessions.controller';
import { ProductionSessionsService } from './production-sessions.service';

@Module({
  imports: [InventoryModule, AuditModule],
  controllers: [ProductionSessionsController],
  providers: [ProductionSessionsService],
  exports: [ProductionSessionsService],
})
export class ProductionSessionsModule {}
