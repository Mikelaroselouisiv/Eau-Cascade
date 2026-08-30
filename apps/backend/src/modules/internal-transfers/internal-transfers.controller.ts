import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InternalTransferStatus } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { resolvedDepartmentIds } from '../../common/user-scope';
import { CreateInternalTransferDto } from './dto/internal-transfer.dto';
import { InternalTransfersService } from './internal-transfers.service';

type ScopeUser = {
  id: number;
  role?: string | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
};

@Controller('internal-transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InternalTransfersController {
  constructor(private readonly transfers: InternalTransfersService) {}

  @Get()
  @PermissionsAny('transfers.manage', 'transfers.confirm', 'production.use', 'deliveries.view')
  list(
    @GetUser() user: ScopeUser,
    @Query('companyId') companyIdRaw?: string,
    @Query('fromDepartmentId') fromRaw?: string,
    @Query('toDepartmentId') toRaw?: string,
    @Query('status') statusRaw?: string,
    @Query('inbox') inboxRaw?: string,
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : undefined;
    const fromDepartmentId = fromRaw ? Number.parseInt(fromRaw, 10) : undefined;
    const toDepartmentId = toRaw ? Number.parseInt(toRaw, 10) : undefined;
    const status =
      statusRaw === 'PENDING' || statusRaw === 'CONFIRMED' || statusRaw === 'REJECTED'
        ? (statusRaw as InternalTransferStatus)
        : undefined;
    const inbox = inboxRaw === '1' || inboxRaw === 'true';
    return this.transfers.list({
      companyId: Number.isFinite(companyId) && companyId! > 0 ? companyId : undefined,
      fromDepartmentId:
        Number.isFinite(fromDepartmentId) && fromDepartmentId! > 0 ? fromDepartmentId : undefined,
      toDepartmentId:
        Number.isFinite(toDepartmentId) && toDepartmentId! > 0 ? toDepartmentId : undefined,
      status,
      inboxDepartmentIds: inbox ? resolvedDepartmentIds(user) : undefined,
    });
  }

  @Post()
  @Permissions('transfers.manage')
  create(@Body() dto: CreateInternalTransferDto, @GetUser() user: ScopeUser) {
    return this.transfers.create(dto, user);
  }

  @Post(':id/confirm')
  @Permissions('transfers.confirm')
  confirm(@Param('id', ParseIntPipe) id: number, @GetUser() user: ScopeUser) {
    if (!id) throw new BadRequestException('id invalide');
    return this.transfers.confirm(id, user);
  }

  @Post(':id/reject')
  @Permissions('transfers.confirm')
  reject(@Param('id', ParseIntPipe) id: number, @GetUser() user: ScopeUser) {
    return this.transfers.reject(id, user);
  }
}
