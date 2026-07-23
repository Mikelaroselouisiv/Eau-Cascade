import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [BanksController],
  providers: [BanksService],
  exports: [BanksService],
})
export class BanksModule {}
