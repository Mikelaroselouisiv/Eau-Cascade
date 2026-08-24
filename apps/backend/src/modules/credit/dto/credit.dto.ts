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
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreateCreditCustomerDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  companyId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId?: number;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimit?: number;
}

export class UpdateCreditCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimit?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId?: number | null;
}

export class CreditSaleItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productSaleUnitId: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;
}

export class CreateCreditSaleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  creditCustomerId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreditSaleItemDto)
  items: CreditSaleItemDto[];

  /** Acompte éventuel à l’achat (encaissé immédiatement). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  downPayment?: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  downPaymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  note?: string;
}

export class RecordCreditPaymentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  creditCustomerId: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  saleId?: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  /** Requis si method = BANK : compte à créditer. */
  @ValidateIf((o: RecordCreditPaymentDto) => o.method === PaymentMethod.BANK)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId?: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
