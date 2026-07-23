import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

@Module({
  imports: [PrismaModule, AuditModule, InventoryModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
