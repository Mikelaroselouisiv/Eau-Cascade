import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { FulfillmentType, PaymentMethod } from '@prisma/client';

export class CreateSaleItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productSaleUnitId: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  /** Prix unitaire saisi à la main (vente spéciale uniquement). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;
}

export class SaleDeliveryStopDto {
  @IsString()
  @MaxLength(500)
  address!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity!: number;
}

export class CreatePaymentDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  reference?: string;

  /** Requis si method = BANK : compte à créditer. */
  @ValidateIf((o: CreatePaymentDto) => o.method === PaymentMethod.BANK)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId?: number;
}

export class CreateSaleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items: CreateSaleItemDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePaymentDto)
  payments: CreatePaymentDto[];

  @ValidateIf((o: CreateSaleDto) => Number.isInteger(o.storeId))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  storeId?: number;

  @ValidateIf((o: CreateSaleDto) => Number.isInteger(o.registerId))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  registerId?: number;

  @IsOptional()
  // Nom client (provenant de la fiche POS)
  clientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientAddress?: string;

  /** Arrêts à domicile (adresse + quantité). À défaut : une seule adresse `clientAddress`. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleDeliveryStopDto)
  deliveryStops?: SaleDeliveryStopDto[];

  /** Sur place (défaut) ou à domicile. */
  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  /** UUID client (offline) — idempotence : rejouer la même vente ne crée pas de doublon. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  clientUuid?: string;

  /** Vente spéciale : prix unitaires saisis manuellement (ADMIN / MANAGER uniquement). */
  @IsOptional()
  @IsBoolean()
  specialSale?: boolean;

  /**
   * Espèces réellement tendues par le client (vente classique ou spéciale).
   * Si fourni : peut être > ou < au total (monnaie due / reste à payer).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amountReceived?: number;
}
