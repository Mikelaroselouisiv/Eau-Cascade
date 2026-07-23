import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { BankTransactionType } from '@prisma/client';

export class CreateBankDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  companyId: number;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateBankDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBankAccountDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankId: number;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBankTransactionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId: number;

  @IsEnum(BankTransactionType)
  type: BankTransactionType;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @MinLength(1)
  description: string;

  @IsOptional()
  @IsString()
  reference?: string;

  /** Date métier YYYY-MM-DD (Port-au-Prince). */
  @IsOptional()
  @IsString()
  occurredOn?: string;
}
