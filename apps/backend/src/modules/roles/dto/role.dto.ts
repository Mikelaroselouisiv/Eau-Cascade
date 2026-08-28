import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { normalizeRoleCode } from '../../../common/role-code';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
}

export class CreateRoleDto {
  @Transform(({ value }) => normalizeRoleCode(value))
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/, {
    message: 'Code de rôle invalide (lettres, chiffres, _ ; commence par une lettre).',
  })
  code: string;

  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @MinLength(2, { message: 'Le libellé doit contenir au moins 2 caractères.' })
  label: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value == null) return undefined;
    const t = String(value).trim();
    return t.length ? t : undefined;
  })
  @IsString()
  description?: string;

  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @ArrayMinSize(1, { message: 'Cochez au moins une autorisation.' })
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : String(value).trim()))
  @IsString()
  @MinLength(2, { message: 'Le libellé doit contenir au moins 2 caractères.' })
  label?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value == null) return null;
    const t = String(value).trim();
    return t.length ? t : null;
  })
  @IsString()
  description?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value == null ? undefined : toStringArray(value)))
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
