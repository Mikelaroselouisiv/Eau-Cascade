import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateProductionWorkerDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId: number;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(6)
  @Matches(/^[0-9+().\s-]+$/, {
    message: 'Numéro de téléphone invalide',
  })
  phone: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  payrollCoefficient: number;
}

export class UpdateProductionWorkerDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @Matches(/^[0-9+().\s-]+$/, {
    message: 'Numéro de téléphone invalide',
  })
  phone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  payrollCoefficient?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class WorkerMovementItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;
}

export class DeclareWorkerMovementDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workerId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  departmentId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkerMovementItemDto)
  items: WorkerMovementItemDto[];
}
