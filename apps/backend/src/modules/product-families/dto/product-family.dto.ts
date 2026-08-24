import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProductFamilyTierDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  minQuantity: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreateProductFamilyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  companyId: number;

  @IsString()
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductFamilyTierDto)
  tiers: ProductFamilyTierDto[];

  /** Produits rattachés à la famille (même entreprise). */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  productIds?: number[];
}

export class UpdateProductFamilyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductFamilyTierDto)
  tiers?: ProductFamilyTierDto[];

  /** Remplace entièrement la liste des produits de la famille. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  productIds?: number[];
}
