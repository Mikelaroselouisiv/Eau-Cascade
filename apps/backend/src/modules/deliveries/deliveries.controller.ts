import {
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
import { DeliveriesService } from './deliveries.service';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { CreateDeliveryDropDto } from './dto/create-delivery-drop.dto';

type AuthUser = {
  id?: number;
  role?: string;
  companyId?: number | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
};

@Controller('deliveries')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Get()
  @Permissions('deliveries.view')
  list(
    @GetUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
    @Query('fulfillmentType') fulfillmentType?: string,
    @Query('q') q?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.deliveriesService.list(user, {
      companyId: DeliveriesController.parsePositiveInt(companyId),
      departmentId: DeliveriesController.parsePositiveInt(departmentId),
      status,
      fulfillmentType,
      q,
      skip: DeliveriesController.parseNonNegativeInt(skip),
      take: DeliveriesController.parsePositiveInt(take),
    });
  }

  @Get(':id')
  @Permissions('deliveries.view')
  findOne(@Param('id', ParseIntPipe) id: number, @GetUser() user: AuthUser) {
    return this.deliveriesService.findOne(id, user);
  }

  @Patch(':id')
  @PermissionsAny('deliveries.manage', 'deliveries.manage_onsite', 'deliveries.manage_home')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeliveryDto,
    @GetUser() user: AuthUser,
  ) {
    return this.deliveriesService.update(id, dto, user);
  }

  @Post(':id/drops')
  @PermissionsAny('deliveries.manage', 'deliveries.manage_onsite', 'deliveries.manage_home')
  addDrop(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDeliveryDropDto,
    @GetUser() user: AuthUser,
  ) {
    return this.deliveriesService.addDrop(id, dto, user);
  }

  private static parsePositiveInt(raw?: string): number | undefined {
    if (raw == null || raw === '') return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  private static parseNonNegativeInt(raw?: string): number | undefined {
    if (raw == null || raw === '') return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
}
