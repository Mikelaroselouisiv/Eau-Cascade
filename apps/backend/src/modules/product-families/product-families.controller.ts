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
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreateProductFamilyDto,
  UpdateProductFamilyDto,
} from './dto/product-family.dto';
import { ProductFamiliesService } from './product-families.service';

@Controller('product-families')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductFamiliesController {
  constructor(private readonly productFamiliesService: ProductFamiliesService) {}

  @Get()
  @Permissions('products.view')
  list(@Query('companyId', ParseIntPipe) companyId: number) {
    return this.productFamiliesService.list(companyId);
  }

  @Get(':id')
  @Permissions('products.view')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.productFamiliesService.getById(id);
  }

  @Post()
  @Permissions('products.manage')
  create(@Body() dto: CreateProductFamilyDto, @GetUser() user?: { id?: number }) {
    return this.productFamiliesService.create(dto, user?.id);
  }

  @Patch(':id')
  @Permissions('products.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductFamilyDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.productFamiliesService.update(id, dto, user?.id);
  }

  @Delete(':id')
  @Permissions('products.manage')
  remove(@Param('id', ParseIntPipe) id: number, @GetUser() user?: { id?: number }) {
    return this.productFamiliesService.softDelete(id, user?.id);
  }
}
