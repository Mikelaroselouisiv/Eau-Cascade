import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreatePackagingUnitDto } from './dto/create-packaging-unit.dto';
import { UpdatePackagingUnitDto } from './dto/update-packaging-unit.dto';
import { PackagingUnitsService } from './packaging-units.service';

@Controller('packaging-units')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PackagingUnitsController {
  constructor(private readonly packagingUnitsService: PackagingUnitsService) {}

  @Get()
  @PermissionsAny('products.view', 'packaging.manage')
  findAll(@Query('departmentId') departmentId: string) {
    const id = Number(departmentId);
    return this.packagingUnitsService.findAll(id);
  }

  @Post()
  @Permissions('packaging.manage')
  create(@Body() dto: CreatePackagingUnitDto) {
    return this.packagingUnitsService.create(dto);
  }

  @Patch(':id')
  @Permissions('packaging.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePackagingUnitDto,
  ) {
    return this.packagingUnitsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('packaging.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.packagingUnitsService.remove(id);
  }
}
