import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Permissions('audit.view')
  list(
    @Query('skip') skipRaw?: string,
    @Query('take') takeRaw?: string,
    @Query('entity') entity?: string,
    @Query('action') action?: string,
    @Query('userId') userIdRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
    @Query('companyId') companyIdRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const skip = skipRaw ? Number.parseInt(skipRaw, 10) : 0;
    const take = takeRaw ? Number.parseInt(takeRaw, 10) : 50;
    const userId = userIdRaw ? Number.parseInt(userIdRaw, 10) : undefined;
    const departmentId = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : undefined;
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : undefined;
    return this.auditService.list({
      skip: Number.isFinite(skip) ? skip : 0,
      take: Number.isFinite(take) ? take : 50,
      entity,
      action,
      userId: userId != null && Number.isFinite(userId) ? userId : undefined,
      departmentId:
        departmentId != null && Number.isFinite(departmentId) ? departmentId : undefined,
      companyId: companyId != null && Number.isFinite(companyId) ? companyId : undefined,
      dateFrom,
      dateTo,
    });
  }
}
