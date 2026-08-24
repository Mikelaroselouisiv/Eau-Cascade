import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductFamiliesController } from './product-families.controller';
import { ProductFamiliesService } from './product-families.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ProductFamiliesController],
  providers: [ProductFamiliesService],
  exports: [ProductFamiliesService],
})
export class ProductFamiliesModule {}
