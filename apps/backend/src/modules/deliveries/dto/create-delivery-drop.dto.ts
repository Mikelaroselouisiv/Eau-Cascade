import { Transform, Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

function optionalPositiveInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

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

  @IsOptional()
  @Transform(({ value }) => optionalPositiveInt(value))
  @IsInt()
  @Min(1)
  carrierId?: number | null;

  /** Arrêt à domicile (adresse) concerné par cette ligne. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  stopId?: number | null;
}
