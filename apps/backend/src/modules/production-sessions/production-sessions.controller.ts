import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CloseProductionSessionDto,
  ClaimProductionSessionDto,
  OpenProductionSessionDto,
} from './dto/production-session.dto';
import { clampToRecentTotalsRange, mustClampRecentTotals } from '../../common/utils/recent-range';
import { RolesService } from '../roles/roles.service';
import { ProductionSessionsService } from './production-sessions.service';

type SessionUser = {
  id: number;
  role?: string | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
};

@Controller('production-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductionSessionsController {
  constructor(
    private readonly productionSessionsService: ProductionSessionsService,
    private readonly rolesService: RolesService,
  ) {}

  @Get('context')
  @Permissions('production.use')
  getContext(
    @GetUser() user: SessionUser,
    @Query('deviceId') deviceId?: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    const id = deviceId?.trim() ?? '';
    if (id.length < 8) {
      throw new BadRequestException('deviceId est requis.');
    }
    const departmentId = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : undefined;
    return this.productionSessionsService.getContext(
      user,
      id,
      Number.isFinite(departmentId) && departmentId! > 0 ? departmentId : undefined,
    );
  }

  @Get('count-sheet')
  @Permissions('production.use')
  countSheet(
    @GetUser() user: SessionUser,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    const departmentId = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : undefined;
    if (!departmentId || !Number.isFinite(departmentId)) {
      throw new BadRequestException('departmentId est requis.');
    }
    return this.productionSessionsService.getCountSheet(departmentId, user);
  }

  @Get('active')
  @Permissions('production.use')
  getActive(@GetUser() user: SessionUser) {
    return this.productionSessionsService.getActiveSessionForUser(user.id);
  }

  @Get()
  @PermissionsAny('stores.manage', 'dashboard.view', 'dashboard.synthesis')
  async list(
    @Query('companyId') companyIdRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
    @Query('openedById') openedByIdRaw?: string,
    @Query('status') statusRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortByRaw?: string,
    @Query('sortDir') sortDirRaw?: string,
    @Query('take') takeRaw?: string,
    @GetUser() user?: { role?: string },
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : undefined;
    const departmentId = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : undefined;
    const openedById = openedByIdRaw ? Number.parseInt(openedByIdRaw, 10) : undefined;
    const take = takeRaw ? Number.parseInt(takeRaw, 10) : undefined;
    const status =
      statusRaw === 'OPEN' || statusRaw === 'CLOSED'
        ? (statusRaw as 'OPEN' | 'CLOSED')
        : undefined;
    const sortBy = sortByRaw === 'userName' ? 'userName' : 'openedAt';
    const sortDir = sortDirRaw === 'asc' ? 'asc' : 'desc';
    const perms = user?.role ? await this.rolesService.getPermissionsForUserRole(user.role) : [];
    const range = mustClampRecentTotals(perms)
      ? clampToRecentTotalsRange(dateFrom, dateTo)
      : { dateFrom, dateTo };
    return this.productionSessionsService.listSessions({
      companyId: Number.isFinite(companyId) && companyId! > 0 ? companyId : undefined,
      departmentId:
        Number.isFinite(departmentId) && departmentId! > 0 ? departmentId : undefined,
      openedById: Number.isFinite(openedById) && openedById! > 0 ? openedById : undefined,
      status,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      sortBy,
      sortDir,
      take: Number.isFinite(take) && take! > 0 ? take : undefined,
    });
  }

  @Get(':id')
  @PermissionsAny('stores.manage', 'dashboard.view', 'dashboard.synthesis', 'production.use')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.productionSessionsService.getSession(id);
  }

  @Post('open')
  @Permissions('production.use')
  open(@Body() dto: OpenProductionSessionDto, @GetUser() user: SessionUser) {
    return this.productionSessionsService.openSession(dto, user);
  }

  @Post(':id/claim')
  @Permissions('production.use')
  claim(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClaimProductionSessionDto,
    @GetUser() user: SessionUser,
  ) {
    return this.productionSessionsService.claimSession(id, dto, user);
  }

  @Post(':id/close')
  @Permissions('production.use')
  close(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseProductionSessionDto,
    @GetUser() user: SessionUser,
  ) {
    return this.productionSessionsService.closeSession(id, dto, user);
  }
}
