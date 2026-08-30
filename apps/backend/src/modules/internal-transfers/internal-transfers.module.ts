import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProductionSessionsModule } from '../production-sessions/production-sessions.module';
import { InternalTransfersController } from './internal-transfers.controller';
import { InternalTransfersService } from './internal-transfers.service';

@Module({
  imports: [AuditModule, ProductionSessionsModule],
  controllers: [InternalTransfersController],
  providers: [InternalTransfersService],
  exports: [InternalTransfersService],
})
export class InternalTransfersModule {}
