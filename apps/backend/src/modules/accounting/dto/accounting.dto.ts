import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JournalCode } from '@prisma/client';

export class CreateFiscalYearDto {
  @IsInt()
  companyId!: number;

  @IsString()
  @MinLength(2)
  label!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}

export class CreateAccountDto {
  @IsInt()
  companyId!: number;

  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsInt()
  @Min(1)
  classNumber!: number;

  @IsOptional()
  @IsIn(['BALANCE_SHEET', 'INCOME_STATEMENT'])
  nature?: 'BALANCE_SHEET' | 'INCOME_STATEMENT';

  @IsOptional()
  isDebitNormal?: boolean;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  classNumber?: number;

  @IsOptional()
  @IsIn(['BALANCE_SHEET', 'INCOME_STATEMENT'])
  nature?: 'BALANCE_SHEET' | 'INCOME_STATEMENT';

  @IsOptional()
  isDebitNormal?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class JournalLineDto {
  @IsString()
  accountCode!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  label?: string;
}

export class CreateManualEntryDto {
  @IsInt()
  companyId!: number;

  @IsDateString()
  entryDate!: string;

  @IsOptional()
  @IsIn(['VE', 'AC', 'BQ', 'CA', 'OD', 'AN'])
  journalCode?: JournalCode;

  @IsString()
  @MinLength(2)
  description!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class BackfillAccountingDto {
  @IsInt()
  companyId!: number;
}

export class CreateSupplierPaymentDto {
  @IsInt()
  companyId!: number;

  @IsString()
  @MinLength(1)
  supplierName!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsIn(['CASH', 'BANK'])
  method?: 'CASH' | 'BANK';

  @IsOptional()
  @IsInt()
  bankAccountId?: number;

  @IsOptional()
  @IsInt()
  goodsReceiptId?: number;

  @IsOptional()
  @IsDateString()
  paidOn?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateFixedAssetDto {
  @IsInt()
  companyId!: number;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsDateString()
  acquisitionDate!: string;

  @IsNumber()
  @Min(0.01)
  acquisitionCost!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  residualValue?: number;

  @IsInt()
  @Min(1)
  usefulLifeMonths!: number;

  @IsOptional()
  @IsIn(['CASH', 'BANK', 'SUPPLIER'])
  paidFrom?: 'CASH' | 'BANK' | 'SUPPLIER';

  @IsOptional()
  @IsInt()
  bankAccountId?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class RunDepreciationDto {
  @IsInt()
  companyId!: number;

  /** Période YYYY-MM */
  @IsString()
  @MinLength(7)
  period!: string;

  @IsOptional()
  @IsInt()
  fixedAssetId?: number;
}
