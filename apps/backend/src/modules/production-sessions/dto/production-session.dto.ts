import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ProductionInventoryLineDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  countedQty: number;
}

export class OpenProductionSessionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionInventoryLineDto)
  lines: ProductionInventoryLineDto[] = [];

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  deviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

export class ClaimProductionSessionDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  deviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

export class CloseProductionSessionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionInventoryLineDto)
  lines: ProductionInventoryLineDto[] = [];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
