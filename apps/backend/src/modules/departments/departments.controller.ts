import {
  BadRequestException,
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
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Controller('departments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @PermissionsAny('config.view', 'pos.use', 'stock.view', 'deliveries.view', 'finance.view')
  findAll(@Query('companyId') companyIdRaw?: string) {
    if (companyIdRaw === undefined || companyIdRaw === '') {
      return this.departmentsService.findAll();
    }
    const id = parseInt(companyIdRaw, 10);
    if (Number.isNaN(id)) {
      throw new BadRequestException('companyId invalide');
    }
    return this.departmentsService.findAll(id);
  }

  @Post()
  @Permissions('departments.manage')
  create(@Body() dto: CreateDepartmentDto) {
    return this.departmentsService.create(dto);
  }

  @Patch(':id')
  @Permissions('departments.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDepartmentDto) {
    return this.departmentsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('departments.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.departmentsService.remove(id);
  }
}
