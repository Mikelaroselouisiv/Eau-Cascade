import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateDeliveryDropDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  saleItemId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  executorName?: string | null;

  /** Arrêt à domicile (adresse) concerné par cette ligne. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  stopId?: number | null;
}
