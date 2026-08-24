import { IsArray, IsISO8601, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SyncPullQueryDto {
  @IsString()
  entity!: string;

  /** ISO8601 ou curseur composite `ISO8601|uuid`. */
  @IsOptional()
  @IsString()
  since?: string;

  @IsOptional()
  @Type(() => Number)
  take?: number;
}

export class SyncRecordDto {
  @IsString()
  uuid!: string;

  @IsOptional()
  @IsISO8601()
  updatedAt?: string;

  @IsOptional()
  @IsISO8601()
  deletedAt?: string | null;

  @IsObject()
  data!: Record<string, unknown>;
}

export class SyncPushDto {
  @IsString()
  entity!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncRecordDto)
  records!: SyncRecordDto[];

  /** Identifiant du nœud émetteur (ex. local-mother). */
  @IsOptional()
  @IsString()
  sourceNodeId?: string;
}
