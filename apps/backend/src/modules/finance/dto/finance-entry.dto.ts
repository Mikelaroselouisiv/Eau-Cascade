import { FinanceType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateFinanceEntryDto {
  @IsEnum(FinanceType)
  type: FinanceType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  description: string;

  /** Précisions libres (optionnel) en plus du libellé. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  detail?: string;

  /**
   * Entreprise ciblée (utile surtout pour l'ADMIN qui peut filtrer/monitorer
   * n'importe quelle entreprise).
   * Si non fourni, le service tente de récupérer la company depuis le userId.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  companyId?: number;

  /**
   * Date comptable (jour) : fixe `createdAt` à ce jour (sinon horodatage serveur).
   * Format YYYY-MM-DD.
   */
  @IsOptional()
  @IsDateString()
  entryDate?: string;
}

export class CloseCashDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedAmount: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedAmount: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  registerId?: number;
}
