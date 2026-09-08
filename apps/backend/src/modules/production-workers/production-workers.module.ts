import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionSessionsModule } from '../production-sessions/production-sessions.module';
import { ProductionWorkersController } from './production-workers.controller';
import { ProductionWorkersService } from './production-workers.service';

@Module({
  imports: [InventoryModule, AuditModule, ProductionSessionsModule],
  controllers: [ProductionWorkersController],
  providers: [ProductionWorkersService],
  exports: [ProductionWorkersService],
})
export class ProductionWorkersModule {}
