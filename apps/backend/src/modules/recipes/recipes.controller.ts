import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpsertRecipeDto } from './dto/recipe.dto';
import { RecipesService } from './recipes.service';

@Controller('recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecipesController {
  constructor(private readonly recipesService: RecipesService) {}

  @Get('by-product/:productId')
  @Permissions('products.view')
  getByProduct(@Param('productId', ParseIntPipe) productId: number) {
    return this.recipesService.getByParentProduct(productId);
  }

  @Put(':productId')
  @Permissions('recipes.manage')
  upsert(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpsertRecipeDto,
  ) {
    return this.recipesService.upsert(productId, dto);
  }

  @Delete(':productId')
  @Permissions('recipes.manage')
  remove(@Param('productId', ParseIntPipe) productId: number) {
    return this.recipesService.remove(productId);
  }
}
