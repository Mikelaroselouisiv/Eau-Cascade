import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

function optionalPositiveInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

export class DeliveryItemUpdateDto {
  @IsNumber()
  saleItemId!: number;

  @IsNumber()
  @Min(0)
  quantityDelivered!: number;
}

export class UpdateDeliveryDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeliveryItemUpdateDto)
  items?: DeliveryItemUpdateDto[];

  /** Marque toute la fiche comme livrée. */
  @IsOptional()
  @IsBoolean()
  markDelivered?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  /** Nom de la personne qui a exécuté la livraison (saisie manuelle, à domicile uniquement). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  executorName?: string | null;

  @IsOptional()
  @Transform(({ value }) => optionalPositiveInt(value))
  @IsInt()
  @Min(1)
  carrierId?: number | null;

  /** Département source du stock (obligatoire pour valider une livraison à domicile). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  stockDepartmentId?: number;

  /** Arrêt à domicile pour « tout livrer » / lignes cumulées. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  stopId?: number;
}
