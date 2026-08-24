import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Controller('companies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompaniesController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  @PermissionsAny('config.view', 'pos.use', 'stock.view', 'deliveries.view', 'finance.view')
  findAll() {
    return this.companyService.findAll();
  }

  @Post()
  @Permissions('company.manage')
  create(@Body() dto: CreateCompanyDto) {
    return this.companyService.create(dto);
  }

  @Get(':id')
  @PermissionsAny('config.view', 'pos.use', 'stock.view', 'deliveries.view', 'finance.view')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.companyService.findOne(id);
  }

  @Patch(':id')
  @Permissions('company.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCompanyDto) {
    return this.companyService.updateById(id, dto);
  }

  @Delete(':id')
  @Permissions('company.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.companyService.remove(id);
  }
}
