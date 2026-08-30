import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DepartmentKind } from '@prisma/client';

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  offersHomeDelivery?: boolean;

  @IsOptional()
  @IsEnum(DepartmentKind)
  kind?: DepartmentKind;
}
