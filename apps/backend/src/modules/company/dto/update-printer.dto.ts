import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdatePrinterDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([58, 80])
  paperWidth?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deviceName?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoCut?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  showLogoOnReceipt?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  receiptHeaderText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  receiptFooterText?: string;

  @IsOptional()
  @IsString()
  receiptLogoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  previewSampleBody?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  showLogoOnDisbursement?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  disbursementHeaderText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  disbursementFooterText?: string;

  @IsOptional()
  @IsString()
  disbursementLogoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  disbursementPreviewSampleBody?: string;
}
