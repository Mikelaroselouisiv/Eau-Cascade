import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export enum InventorySessionKindDto {
  OPENING = 'OPENING',
  CLOSING = 'CLOSING',
  AD_HOC = 'AD_HOC',
}

export class CreateInventorySessionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId: number;

  @IsOptional()
  @IsEnum(InventorySessionKindDto)
  kind?: InventorySessionKindDto;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  note?: string;

  /** Si true : n’inclut que les produits dont le stock système est > 0. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
  @IsBoolean()
  onlyPositiveStock?: boolean;
}

export class UpdateInventoryLineDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  countedQty?: number | null;

  @IsOptional()
  @IsString()
  note?: string;
}
