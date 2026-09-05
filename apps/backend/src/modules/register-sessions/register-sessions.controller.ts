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
import { RegisterSessionStatus } from '@prisma/client';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  ClaimRegisterSessionDto,
  CloseRegisterSessionDto,
  CreateRegisterDto,
  OpenRegisterSessionDto,
} from './dto/register-session.dto';
import { clampToRecentTotalsRange, mustClampRecentTotals } from '../../common/utils/recent-range';
import { RolesService } from '../roles/roles.service';
import { RegisterSessionsService } from './register-sessions.service';

@Controller('register-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RegisterSessionsController {
  constructor(
    private readonly registerSessionsService: RegisterSessionsService,
    private readonly rolesService: RolesService,
  ) {}

  @Get('registers')
  @Permissions('pos.use')
  listRegisters(
    @Query('companyId') companyIdRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : undefined;
    const departmentId = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : undefined;
    return this.registerSessionsService.listRegisters({
      companyId: Number.isFinite(companyId) && companyId! > 0 ? companyId : undefined,
      departmentId:
        Number.isFinite(departmentId) && departmentId! > 0 ? departmentId : undefined,
    });
  }

  @Post('registers')
  @Permissions('stores.manage')
  createRegister(@Body() dto: CreateRegisterDto) {
    return this.registerSessionsService.createRegister(dto);
  }

  @Post('registers/ensure-default')
  @Permissions('pos.use')
  ensureDefaultRegister(
    @Query('companyId') companyIdRaw: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    const companyId = Number.parseInt(companyIdRaw, 10);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      throw new BadRequestException('companyId est requis.');
    }
    const departmentId = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : undefined;
    return this.registerSessionsService.ensureDefaultRegister(
      companyId,
      Number.isFinite(departmentId) && departmentId! > 0 ? departmentId : undefined,
    );
  }

  @Get('active')
  @PermissionsAny('pos.use', 'credit.manage')
  getActive(@GetUser() user: { id: number }) {
    return this.registerSessionsService.getActiveSessionForUser(user.id);
  }

  @Get('context')
  @Permissions('pos.use')
  getContext(
    @GetUser() user: { id: number },
    @Query('deviceId') deviceId?: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    const id = deviceId?.trim() ?? '';
    if (id.length < 8) {
      throw new BadRequestException('deviceId est requis.');
    }
    const departmentId = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : undefined;
    return this.registerSessionsService.getSessionContext(
      user.id,
      id,
      Number.isFinite(departmentId) && departmentId! > 0 ? departmentId : undefined,
    );
  }

  @Get()
  @PermissionsAny('stores.manage', 'dashboard.view', 'dashboard.synthesis')
  async list(
    @Query('companyId') companyIdRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
    @Query('registerId') registerIdRaw?: string,
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
    const registerId = registerIdRaw ? Number.parseInt(registerIdRaw, 10) : undefined;
    const openedById = openedByIdRaw ? Number.parseInt(openedByIdRaw, 10) : undefined;
    const take = takeRaw ? Number.parseInt(takeRaw, 10) : undefined;
    const status =
      statusRaw === 'OPEN' || statusRaw === 'CLOSED'
        ? (statusRaw as RegisterSessionStatus)
        : undefined;
    const sortBy = sortByRaw === 'userName' ? 'userName' : 'openedAt';
    const sortDir = sortDirRaw === 'asc' ? 'asc' : 'desc';
    const perms = user?.role ? await this.rolesService.getPermissionsForUserRole(user.role) : [];
    const range = mustClampRecentTotals(perms)
      ? clampToRecentTotalsRange(dateFrom, dateTo)
      : { dateFrom, dateTo };

    return this.registerSessionsService.listSessions({
      companyId: Number.isFinite(companyId) && companyId! > 0 ? companyId : undefined,
      departmentId:
        Number.isFinite(departmentId) && departmentId! > 0 ? departmentId : undefined,
      registerId: Number.isFinite(registerId) && registerId! > 0 ? registerId : undefined,
      openedById: Number.isFinite(openedById) && openedById! > 0 ? openedById : undefined,
      status,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      sortBy,
      sortDir,
      take,
    });
  }

  @Get(':id/closing-cash-preview')
  @Permissions('pos.use')
  closingCashPreview(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user: { id: number },
  ) {
    return this.registerSessionsService.getClosingCashPreview(id, user.id);
  }

  @Get(':id/expenses')
  @Permissions('pos.use')
  sessionExpenses(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user: { id: number },
  ) {
    return this.registerSessionsService.listSessionExpenses(id, user.id);
  }

  @Get(':id')
  @Permissions('pos.use')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.registerSessionsService.getSession(id);
  }

  @Post('open')
  @Permissions('pos.use')
  open(@Body() dto: OpenRegisterSessionDto, @GetUser() user: { id: number }) {
    return this.registerSessionsService.openSession(dto, user.id);
  }

  @Post(':id/claim')
  @Permissions('pos.use')
  claim(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClaimRegisterSessionDto,
    @GetUser() user: { id: number },
  ) {
    return this.registerSessionsService.claimSession(id, dto, user.id);
  }

  @Post(':id/close')
  @Permissions('pos.use')
  close(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseRegisterSessionDto,
    @GetUser() user: { id: number },
  ) {
    return this.registerSessionsService.closeSession(id, dto, user.id);
  }
}
