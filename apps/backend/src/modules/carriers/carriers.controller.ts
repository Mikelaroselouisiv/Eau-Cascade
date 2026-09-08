import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateCarrierDto, UpdateCarrierDto } from './dto/carrier.dto';
import { CarriersService } from './carriers.service';

type ScopeUser = {
  id: number;
  role?: string | null;
  companyId?: number | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
};

@Controller('carriers')
@UseGuards(JwtAuthGuard, RolesGuard)
@PermissionsAny('production.use', 'deliveries.manage', 'deliveries.manage_home', 'deliveries.view')
export class CarriersController {
  constructor(private readonly carriers: CarriersService) {}

  @Get()
  list(
    @GetUser() user: ScopeUser,
    @Query('departmentId') departmentRaw?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const departmentId = departmentRaw ? Number.parseInt(departmentRaw, 10) : NaN;
    if (!Number.isFinite(departmentId) || departmentId <= 0) {
      throw new BadRequestException('departmentId est requis.');
    }
    return this.carriers.list(departmentId, user, {
      includeInactive: includeInactive === '1' || includeInactive === 'true',
      dateFrom,
      dateTo,
    });
  }

  @Get(':id')
  getOne(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user: ScopeUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.carriers.getOne(id, user, { dateFrom, dateTo });
  }

  @Post()
  @Permissions('carriers.manage')
  create(@Body() dto: CreateCarrierDto, @GetUser() user: ScopeUser) {
    return this.carriers.create(dto, user);
  }

  @Patch(':id')
  @Permissions('carriers.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCarrierDto,
    @GetUser() user: ScopeUser,
  ) {
    return this.carriers.update(id, dto, user);
  }
}
