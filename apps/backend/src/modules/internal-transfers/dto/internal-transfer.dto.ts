import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class InternalTransferItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;
}

export class CreateInternalTransferDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromDepartmentId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  toDepartmentId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InternalTransferItemDto)
  items: InternalTransferItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
