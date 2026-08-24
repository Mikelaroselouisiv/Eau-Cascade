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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CloseRegisterSessionDto,
  CreateRegisterDto,
  OpenRegisterSessionDto,
} from './dto/register-session.dto';
import { RegisterSessionsService } from './register-sessions.service';

@Controller('register-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RegisterSessionsController {
  constructor(private readonly registerSessionsService: RegisterSessionsService) {}

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
  ensureDefaultRegister(@Query('companyId') companyIdRaw: string) {
    const companyId = Number.parseInt(companyIdRaw, 10);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      throw new BadRequestException('companyId est requis.');
    }
    return this.registerSessionsService.ensureDefaultRegister(companyId);
  }

  @Get('active')
  @Permissions('pos.use')
  getActive(@GetUser() user: { id: number }) {
    return this.registerSessionsService.getActiveSessionForUser(user.id);
  }

  @Get()
  @Permissions('stores.manage')
  list(
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

    return this.registerSessionsService.listSessions({
      companyId: Number.isFinite(companyId) && companyId! > 0 ? companyId : undefined,
      departmentId:
        Number.isFinite(departmentId) && departmentId! > 0 ? departmentId : undefined,
      registerId: Number.isFinite(registerId) && registerId! > 0 ? registerId : undefined,
      openedById: Number.isFinite(openedById) && openedById! > 0 ? openedById : undefined,
      status,
      dateFrom,
      dateTo,
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
