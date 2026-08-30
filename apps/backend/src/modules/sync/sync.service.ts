import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BankTransactionType, Prisma } from '@prisma/client';
import { normalizeRoleCode } from '../../common/role-code';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncPushDto, SyncRecordDto } from './dto/sync.dto';
import {
  APPEND_ONLY_ENTITIES,
  isSyncEntity,
  SYNC_ENTITIES,
  type SyncEntityName,
} from './sync.entities';
import { ENTITY_FK_MAP, RELATION_OBJECT_KEYS } from './sync-fk';

type Delegate = {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  findFirst?: (args: unknown) => Promise<Record<string, unknown> | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
};

/** Modèles sync sans soft-delete (pas de colonne deletedAt). */
const NO_DELETED_AT = new Set<SyncEntityName>([
  'AuditLog',
  'DeliveryItem',
  'SaleDeliveryStop',
  'DeliveryDrop',
  'ProductionFlow',
]);

/** Modèles sans updatedAt : curseur pull sur createdAt. */
const NO_UPDATED_AT = new Set<SyncEntityName>(['AuditLog']);

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  listEntities() {
    return [...SYNC_ENTITIES];
  }

  async pull(entity: string, since?: string, take = 200) {
    if (!isSyncEntity(entity)) {
      throw new BadRequestException(`Entité sync inconnue: ${entity}`);
    }
    const limit = Math.min(Math.max(take || 200, 1), 1000);
    const cursor = this.parsePullCursor(since);
    const timeField = NO_UPDATED_AT.has(entity) ? 'createdAt' : 'updatedAt';

    const where =
      cursor.uuid != null
        ? {
            OR: [
              { [timeField]: { gt: cursor.at } },
              {
                AND: [{ [timeField]: cursor.at }, { uuid: { gt: cursor.uuid } }],
              },
            ],
          }
        : { [timeField]: { gt: cursor.at } };

    const rows = await this.delegate(entity).findMany({
      where,
      orderBy: [{ [timeField]: 'asc' }, { uuid: 'asc' }],
      take: limit,
    });

    const records: Array<{
      uuid: string;
      updatedAt: string;
      deletedAt: string | null;
      data: Record<string, unknown>;
    }> = [];
    for (const row of rows) {
      records.push(await this.toSyncRecord(entity, row));
    }
    const last = rows[rows.length - 1];
    let nextCursor = this.formatPullCursor(cursor.at, cursor.uuid);
    if (last) {
      const lastAtRaw = last[timeField] ?? last.createdAt;
      const lastAt = lastAtRaw ? new Date(String(lastAtRaw)) : cursor.at;
      const lastUuid = last.uuid != null ? String(last.uuid) : null;
      if (!Number.isNaN(lastAt.getTime())) {
        nextCursor = this.formatPullCursor(lastAt, lastUuid);
      }
    }

    return { entity, records, nextCursor, count: records.length };
  }

  /** Curseur composite `ISO8601` ou `ISO8601|uuid` (évite les trous à horodatage égal). */
  private parsePullCursor(since?: string): { at: Date; uuid: string | null } {
    if (!since?.trim()) {
      return { at: new Date(0), uuid: null };
    }
    const raw = since.trim();
    const pipe = raw.lastIndexOf('|');
    if (pipe > 0) {
      const iso = raw.slice(0, pipe);
      const uuid = raw.slice(pipe + 1).trim();
      const at = new Date(iso);
      if (!Number.isNaN(at.getTime()) && uuid.length > 0) {
        return { at, uuid };
      }
    }
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) {
      throw new BadRequestException('since invalide (ISO 8601 ou ISO|uuid attendu)');
    }
    return { at, uuid: null };
  }

  private formatPullCursor(at: Date, uuid: string | null): string {
    const iso = at.toISOString();
    return uuid ? `${iso}|${uuid}` : iso;
  }

  async push(dto: SyncPushDto) {
    if (!isSyncEntity(dto.entity)) {
      throw new BadRequestException(`Entité sync inconnue: ${dto.entity}`);
    }
    const entity = dto.entity;
    const results: Array<{
      uuid: string;
      action: 'created' | 'updated' | 'skipped' | 'error';
      error?: string;
    }> = [];

    for (const record of dto.records) {
      try {
        const action = await this.applyRecord(entity, record);
        if (
          (action === 'created' || action === 'updated') &&
          (entity === 'Payment' || entity === 'CreditPayment')
        ) {
          await this.ensureBankDepositForSyncedPayment(entity, record.uuid);
        }
        results.push({ uuid: record.uuid, action });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Push ${entity}/${record.uuid}: ${message}`);
        results.push({ uuid: record.uuid, action: 'error', error: message });
      }
    }

    return {
      entity,
      sourceNodeId: dto.sourceNodeId ?? null,
      results,
      applied: results.filter((r) => r.action === 'created' || r.action === 'updated').length,
      skipped: results.filter((r) => r.action === 'skipped').length,
      errors: results.filter((r) => r.action === 'error').length,
    };
  }

  /**
   * Instant effectif LWW : max(updatedAt, deletedAt).
   * Une suppression soft plus récente gagne sur une édition plus ancienne (et l’inverse).
   */
  private effectiveWriteAt(row: {
    updatedAt?: unknown;
    deletedAt?: unknown;
  }): Date {
    const updated = row.updatedAt ? new Date(String(row.updatedAt)) : new Date(0);
    if (Number.isNaN(updated.getTime())) {
      return new Date(0);
    }
    if (!row.deletedAt) return updated;
    const deleted = new Date(String(row.deletedAt));
    if (Number.isNaN(deleted.getTime())) return updated;
    return deleted > updated ? deleted : updated;
  }

  private async applyRecord(
    entity: SyncEntityName,
    record: SyncRecordDto,
  ): Promise<'created' | 'updated' | 'skipped'> {
    if (!record.uuid?.trim()) {
      throw new BadRequestException('uuid requis');
    }

    const existing = await this.delegate(entity).findUnique({
      where: { uuid: record.uuid },
    });

    if (APPEND_ONLY_ENTITIES.has(entity)) {
      if (existing) {
        if (entity === 'CreditPayment') {
          await this.healCreditPaymentRegisterSession(existing, record);
        }
        return 'skipped';
      }
      await this.createFromSync(entity, record);
      return 'created';
    }

    const incomingAt = this.effectiveWriteAt({
      updatedAt: record.updatedAt ?? new Date().toISOString(),
      deletedAt: record.deletedAt,
    });
    if (existing) {
      if (!this.shouldApplyIncoming(entity, record, existing, incomingAt)) {
        // Même si LWW ignore le reste, réparer un txnNumber manquant / backfill local erroné.
        if (entity === 'Sale') {
          await this.healSaleTxnNumber(existing, record);
        }
        return 'skipped';
      }
      await this.updateFromSync(entity, record.uuid, record, { existing });
      return 'updated';
    }

    // Même vente / ligne déjà présente sous un autre uuid (fiche fantôme ensureForSale).
    const byNaturalKey = await this.findByNaturalKey(entity, record);
    if (byNaturalKey) {
      if (!this.shouldApplyIncoming(entity, record, byNaturalKey, incomingAt)) {
        if (entity === 'Sale') {
          await this.healSaleTxnNumber(byNaturalKey, record);
        }
        return 'skipped';
      }
      const localUuid = String(byNaturalKey.uuid);
      await this.updateFromSync(entity, localUuid, record, {
        adoptUuid: true,
        existing: byNaturalKey,
      });
      this.logger.log(
        `Sync ${entity}: fusion clé naturelle ${localUuid} → ${record.uuid}`,
      );
      return 'updated';
    }

    await this.createFromSync(entity, record);
    return 'created';
  }

  /**
   * CreditPayment est append-only : si la session caisse n’était pas encore
   * sur ce nœud au premier insert, rattacher dès que le uuid est résoluble.
   */
  private async healCreditPaymentRegisterSession(
    existing: Record<string, unknown>,
    record: SyncRecordDto,
  ): Promise<void> {
    if (existing.registerSessionId != null) return;
    const sessionUuid = record.data?.registerSessionUuid;
    if (typeof sessionUuid !== 'string' || !sessionUuid.trim()) return;
    const session = await this.prisma.registerSession.findUnique({
      where: { uuid: sessionUuid.trim() },
      select: { id: true },
    });
    if (!session) return;
    await this.prisma.creditPayment.update({
      where: { uuid: String(existing.uuid) },
      data: { registerSessionId: session.id },
    });
  }

  /**
   * Numéro métier imprimé sur le ticket / carte livraison.
   * Ne doit jamais être écrasé par l’id local du nœud cible après sync.
   */
  private async healSaleTxnNumber(
    existing: Record<string, unknown>,
    record: SyncRecordDto,
  ): Promise<void> {
    const incoming = Number(record.data?.txnNumber);
    if (!Number.isFinite(incoming) || incoming <= 0) return;
    const localId = Number(existing.id);
    const current =
      existing.txnNumber == null || existing.txnNumber === ''
        ? null
        : Number(existing.txnNumber);
    const needsHeal =
      current == null ||
      !Number.isFinite(current) ||
      (Number.isFinite(localId) && current === localId && incoming !== localId);
    if (!needsHeal) return;
    try {
      await this.prisma.sale.update({
        where: { uuid: String(existing.uuid) },
        data: { txnNumber: incoming },
      });
      this.logger.log(
        `Sync Sale: txnNumber réparé ${String(existing.uuid)} → ${incoming}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Sync Sale txnNumber heal: ${message}`);
    }
  }

  private preserveSaleTxnNumber(
    data: Record<string, unknown>,
    existing?: Record<string, unknown> | null,
  ): void {
    const incomingRaw = data.txnNumber;
    const incoming =
      incomingRaw == null || incomingRaw === '' ? null : Number(incomingRaw);
    const localId = existing?.id != null ? Number(existing.id) : null;
    const current =
      existing?.txnNumber == null || existing?.txnNumber === ''
        ? null
        : Number(existing.txnNumber);

    if (incoming == null || !Number.isFinite(incoming) || incoming <= 0) {
      // Ne jamais nullifier un txnNumber déjà connu.
      delete data.txnNumber;
      return;
    }

    if (
      current != null &&
      Number.isFinite(current) &&
      !(localId != null && current === localId && incoming !== localId)
    ) {
      // Déjà un numéro métier stable (≠ simple backfill id local) : immutable.
      delete data.txnNumber;
    }
  }

  /**
   * Delivery / DeliveryItem : une seule fiche par vente / ligne.
   * En cas de conflit, le statut (ou qty) le plus avancé gagne, pas seulement updatedAt.
   */
  private shouldApplyIncoming(
    entity: SyncEntityName,
    record: SyncRecordDto,
    existing: Record<string, unknown>,
    incomingAt: Date,
  ): boolean {
    if (entity === 'Delivery') {
      const inRank = this.deliveryStatusRank(record.data?.status);
      const exRank = this.deliveryStatusRank(existing.status);
      if (inRank !== exRank) return inRank > exRank;
    }
    if (entity === 'InternalTransfer') {
      const inRank = this.transferStatusRank(record.data?.status);
      const exRank = this.transferStatusRank(existing.status);
      if (inRank !== exRank) return inRank > exRank;
    }
    if (entity === 'DeliveryItem') {
      const inQty = Number(record.data?.quantityDelivered ?? 0);
      const exQty = Number(existing.quantityDelivered ?? 0);
      if (Number.isFinite(inQty) && Number.isFinite(exQty) && inQty !== exQty) {
        return inQty > exQty;
      }
    }
    const existingAt = this.effectiveWriteAt(existing);
    return incomingAt > existingAt;
  }

  private deliveryStatusRank(status: unknown): number {
    const s = String(status ?? 'PENDING');
    if (s === 'DELIVERED') return 2;
    if (s === 'PARTIAL') return 1;
    return 0;
  }

  private transferStatusRank(status: unknown): number {
    const s = String(status ?? 'PENDING');
    if (s === 'CONFIRMED' || s === 'REJECTED') return 1;
    return 0;
  }

  private async findByNaturalKey(
    entity: SyncEntityName,
    record: SyncRecordDto,
  ): Promise<Record<string, unknown> | null> {
    if (entity === 'Delivery') {
      const saleUuid = record.data?.saleUuid;
      if (saleUuid == null || saleUuid === '') return null;
      const sale = await this.prisma.sale.findUnique({
        where: { uuid: String(saleUuid) },
        select: { id: true },
      });
      if (!sale) return null;
      return this.prisma.delivery.findUnique({
        where: { saleId: sale.id },
      }) as Promise<Record<string, unknown> | null>;
    }
    if (entity === 'DeliveryItem') {
      const saleItemUuid = record.data?.saleItemUuid;
      if (saleItemUuid == null || saleItemUuid === '') return null;
      const saleItem = await this.prisma.saleItem.findUnique({
        where: { uuid: String(saleItemUuid) },
        select: { id: true },
      });
      if (!saleItem) return null;
      return this.prisma.deliveryItem.findUnique({
        where: { saleItemId: saleItem.id },
      }) as Promise<Record<string, unknown> | null>;
    }
    if (entity === 'AppRole') {
      const code = normalizeRoleCode(record.data?.code);
      if (!code) return null;
      return this.prisma.appRole.findFirst({
        where: { code },
      }) as Promise<Record<string, unknown> | null>;
    }
    if (entity === 'UserDepartment') {
      const userUuid = record.data?.userUuid;
      const departmentUuid = record.data?.departmentUuid;
      if (!userUuid || !departmentUuid) return null;
      const user = await this.prisma.user.findUnique({
        where: { uuid: String(userUuid) },
        select: { id: true },
      });
      const department = await this.prisma.department.findUnique({
        where: { uuid: String(departmentUuid) },
        select: { id: true },
      });
      if (!user || !department) return null;
      return this.prisma.userDepartment.findUnique({
        where: {
          userId_departmentId: { userId: user.id, departmentId: department.id },
        },
      }) as Promise<Record<string, unknown> | null>;
    }
    return null;
  }

  private async createFromSync(entity: SyncEntityName, record: SyncRecordDto) {
    const data = await this.sanitizePayload(entity, record);
    let healTxnFromId = false;
    if (entity === 'Sale') {
      const txn = Number(data.txnNumber);
      if (!Number.isFinite(txn) || txn <= 0) {
        // Anciennes ventes cloud sans txnNumber : créer puis backfill id (ne plus bloquer le sync).
        delete data.txnNumber;
        healTxnFromId = true;
        this.logger.warn(
          `Sync Sale ${record.uuid}: txnNumber manquant — création puis backfill id`,
        );
      }
    }
    try {
      const created = await this.delegate(entity).create({ data });
      if (healTxnFromId && entity === 'Sale') {
        const id = Number(created.id);
        if (Number.isFinite(id) && id > 0) {
          await this.prisma.sale.update({
            where: { id },
            data: { txnNumber: id },
          });
        }
      }
    } catch (err) {
      // Course : fiche créée entre findByNaturalKey et create.
      if (
        (entity === 'Delivery' ||
          entity === 'DeliveryItem' ||
          entity === 'AppRole' ||
          entity === 'UserDepartment') &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const shadow = await this.findByNaturalKey(entity, record);
        if (shadow) {
          await this.updateFromSync(entity, String(shadow.uuid), record, {
            adoptUuid: true,
          });
          return;
        }
      }
      throw err;
    }
  }

  private async updateFromSync(
    entity: SyncEntityName,
    whereUuid: string,
    record: SyncRecordDto,
    opts?: { adoptUuid?: boolean; existing?: Record<string, unknown> | null },
  ) {
    const data = await this.sanitizePayload(entity, record);
    if (!opts?.adoptUuid) {
      delete data.uuid;
    } else {
      data.uuid = record.uuid;
    }
    if (entity === 'Sale') {
      this.preserveSaleTxnNumber(data, opts?.existing);
    }
    if (entity === 'AppRole' && opts?.existing?.isSystem === true) {
      data.isSystem = true;
    }
    await this.delegate(entity).update({
      where: { uuid: whereUuid },
      data,
    });
  }

  /**
   * Payload sync : scalaires + uuid/timestamps + FK résolues via *Uuid → id local.
   */
  private async sanitizePayload(
    entity: SyncEntityName,
    record: SyncRecordDto,
  ): Promise<Record<string, unknown>> {
    const raw: Record<string, unknown> = { ...record.data };
    raw.uuid = record.uuid;

    // AuditLog n’a que createdAt (pas updatedAt / deletedAt).
    if (entity === 'AuditLog') {
      delete raw.updatedAt;
      delete raw.deletedAt;
      if (record.updatedAt && !raw.createdAt) {
        raw.createdAt = new Date(record.updatedAt);
      } else if (typeof raw.createdAt === 'string') {
        raw.createdAt = new Date(raw.createdAt);
      }
    } else if (NO_DELETED_AT.has(entity)) {
      delete raw.deletedAt;
      if (record.updatedAt) raw.updatedAt = new Date(record.updatedAt);
    } else {
      if (record.updatedAt) raw.updatedAt = new Date(record.updatedAt);
      if (record.deletedAt === null) raw.deletedAt = null;
      else if (record.deletedAt) raw.deletedAt = new Date(record.deletedAt);
    }

    delete raw.id;
    for (const key of RELATION_OBJECT_KEYS) {
      delete raw[key];
    }

    await this.resolveForeignKeys(entity, raw);
    if (entity === 'AppRole') {
      this.normalizeAppRolePayload(raw);
    }
    // Ne jamais planter le sync si le nœud source a des colonnes
    // plus récentes que le Prisma client local (ex. txnNumber avant redeploy).
    this.stripUnknownScalarFields(entity, raw);
    return raw;
  }

  /** Code + permissions : même forme d’un nœud à l’autre (String[]). */
  private normalizeAppRolePayload(raw: Record<string, unknown>): void {
    if (raw.code != null) {
      raw.code = normalizeRoleCode(raw.code);
    }
    if (raw.permissions === undefined) {
      delete raw.permissions;
      return;
    }
    raw.permissions = this.coercePermissionList(raw.permissions);
  }

  private coercePermissionList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map((v) => String(v).trim()).filter(Boolean)));
    }
    if (typeof value === 'string' && value.trim()) {
      const t = value.trim();
      if (t.startsWith('[')) {
        try {
          const parsed = JSON.parse(t) as unknown;
          if (Array.isArray(parsed)) return this.coercePermissionList(parsed);
        } catch {
          /* liste Postgres {a,b} */
        }
      }
      return t
        .replace(/^{|}$/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    }
    return [];
  }

  private stripUnknownScalarFields(
    entity: SyncEntityName,
    data: Record<string, unknown>,
  ): void {
    try {
      const models = Prisma.dmmf.datamodel.models;
      const model = models.find((m) => m.name === entity);
      if (!model) return;
      const allowed = new Set(model.fields.map((f) => f.name));
      for (const key of Object.keys(data)) {
        if (key.endsWith('Uuid')) continue;
        if (!allowed.has(key)) delete data[key];
      }
    } catch {
      /* ignore — best effort */
    }
  }

  /** Remplace les Int source par les ids locaux via les uuid parents. */
  private async resolveForeignKeys(
    entity: SyncEntityName,
    data: Record<string, unknown>,
  ): Promise<void> {
    const refs = ENTITY_FK_MAP[entity] ?? [];
    for (const ref of refs) {
      const legacyId = data[ref.idField];
      // Jamais laisser l’Int source tel quel sans contrôle.
      delete data[ref.idField];

      const uuidVal = data[ref.uuidField];
      delete data[ref.uuidField];

      if (uuidVal != null && uuidVal !== '') {
        const parent = await this.delegate(ref.parent).findUnique({
          where: { uuid: String(uuidVal) },
        });
        if (!parent?.id) {
          if (ref.required) {
            throw new BadRequestException(
              `Parent ${ref.parent} introuvable (uuid=${uuidVal}) pour ${entity}`,
            );
          }
          data[ref.idField] = null;
          continue;
        }
        data[ref.idField] = Number(parent.id);
        continue;
      }

      // Compat payloads anciens (avant enrich *Uuid) : tenter l’id local si la ligne existe.
      if (legacyId != null && legacyId !== '') {
        const parentById = await this.delegate(ref.parent).findUnique({
          where: { id: Number(legacyId) },
        });
        if (parentById?.id) {
          data[ref.idField] = Number(parentById.id);
          continue;
        }
      }

      if (ref.required) {
        throw new BadRequestException(
          `FK requise manquante: ${ref.uuidField} pour ${entity}`,
        );
      }
      data[ref.idField] = null;
    }

    // Paiement banque : ne jamais accepter method=BANK sans compte résolu
    // (sinon le capital bancaire reste à 0 sur le nœud cible).
    if (
      (entity === 'Payment' || entity === 'CreditPayment') &&
      data.method === 'BANK' &&
      (data.bankAccountId == null || data.bankAccountId === '')
    ) {
      throw new BadRequestException(
        `${entity} BANK sans bankAccountUuid résolu — sync BankAccount d’abord`,
      );
    }

    // Nettoyer tout *Uuid résiduel non mappé
    for (const key of Object.keys(data)) {
      if (key.endsWith('Uuid') && key !== 'uuid' && key !== 'clientUuid') {
        delete data[key];
      }
    }
  }

  private async toSyncRecord(entity: SyncEntityName, row: Record<string, unknown>) {
    const { id: _id, ...rest } = row;
    const uuid = String(row.uuid ?? '');
    const updatedAt =
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt
          ? String(row.updatedAt)
          : row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : row.createdAt
              ? String(row.createdAt)
              : new Date(0).toISOString();
    const deletedAt =
      row.deletedAt instanceof Date
        ? row.deletedAt.toISOString()
        : row.deletedAt
          ? String(row.deletedAt)
          : null;

    const data = this.serializeRow(rest);
    for (const key of RELATION_OBJECT_KEYS) {
      delete data[key];
    }
    await this.enrichParentUuids(entity, row, data);

    return {
      uuid,
      updatedAt,
      deletedAt,
      data,
    };
  }

  /** Ajoute companyUuid / departmentUuid / … et retire les Int FK du payload filaire. */
  private async enrichParentUuids(
    entity: SyncEntityName,
    row: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<void> {
    const refs = ENTITY_FK_MAP[entity] ?? [];
    for (const ref of refs) {
      const idVal = row[ref.idField];
      delete data[ref.idField];
      if (idVal == null || idVal === '') {
        data[ref.uuidField] = null;
        continue;
      }
      try {
        const parent = await this.delegate(ref.parent).findUnique({
          where: { id: Number(idVal) },
        });
        data[ref.uuidField] = parent?.uuid ? String(parent.uuid) : null;
      } catch {
        data[ref.uuidField] = null;
      }
    }
  }

  private serializeRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v instanceof Date) out[k] = v.toISOString();
      else if (v instanceof Prisma.Decimal) out[k] = v.toString();
      else if (typeof v === 'bigint') out[k] = Number(v);
      else if (Array.isArray(v)) {
        if (
          v.every(
            (x) =>
              x == null ||
              typeof x === 'string' ||
              typeof x === 'number' ||
              typeof x === 'boolean',
          )
        ) {
          out[k] = v;
        }
      } else if (v !== null && typeof v === 'object') continue;
      else out[k] = v;
    }
    return out;
  }

  /**
   * Compense un paiement BANK synchronisé sans dépôt local
   * (ex. ancien agent qui n’envoyait pas BankTransaction).
   */
  private async ensureBankDepositForSyncedPayment(
    entity: 'Payment' | 'CreditPayment',
    uuid: string,
  ): Promise<void> {
    if (entity === 'Payment') {
      const payment = await this.prisma.payment.findUnique({
        where: { uuid },
        include: {
          sale: { select: { id: true, txnNumber: true, status: true, deletedAt: true } },
          bankAccount: {
            select: { id: true, name: true, bank: { select: { name: true } } },
          },
        },
      });
      if (
        !payment ||
        payment.deletedAt ||
        payment.method !== 'BANK' ||
        payment.bankAccountId == null ||
        !payment.bankAccount ||
        payment.sale.deletedAt ||
        payment.sale.status !== 'COMPLETED' ||
        Number(payment.amount) <= 0.009
      ) {
        return;
      }
      const txnRef =
        payment.sale.txnNumber != null
          ? `saleTxn:${payment.sale.txnNumber}`
          : `sale:${payment.saleId}`;
      const refs = [`sale:${payment.saleId}`, txnRef];
      const existing = await this.prisma.bankTransaction.findFirst({
        where: {
          deletedAt: null,
          type: BankTransactionType.DEPOSIT,
          reference: { in: refs },
        },
        select: { id: true },
      });
      if (existing) return;
      await this.prisma.bankTransaction.create({
        data: {
          bankAccountId: payment.bankAccountId,
          type: BankTransactionType.DEPOSIT,
          amount: payment.amount,
          description: `Vente #${payment.sale.txnNumber ?? payment.saleId} — ${payment.bankAccount.bank.name} / ${payment.bankAccount.name}`,
          reference: txnRef,
          occurredAt: payment.createdAt,
        },
      });
      return;
    }

    const creditPay = await this.prisma.creditPayment.findUnique({
      where: { uuid },
      include: {
        creditCustomer: { select: { name: true } },
        bankAccount: {
          select: { id: true, name: true, bank: { select: { name: true } } },
        },
      },
    });
    if (
      !creditPay ||
      creditPay.deletedAt ||
      creditPay.method !== 'BANK' ||
      creditPay.bankAccountId == null ||
      !creditPay.bankAccount ||
      Number(creditPay.amount) <= 0.009
    ) {
      return;
    }
    const ref = `creditPayment:${creditPay.uuid}`;
    const existing = await this.prisma.bankTransaction.findFirst({
      where: {
        deletedAt: null,
        type: BankTransactionType.DEPOSIT,
        reference: ref,
      },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.bankTransaction.create({
      data: {
        bankAccountId: creditPay.bankAccountId,
        type: BankTransactionType.DEPOSIT,
        amount: creditPay.amount,
        description: `Remboursement crédit — ${creditPay.creditCustomer.name} — ${creditPay.bankAccount.bank.name} / ${creditPay.bankAccount.name}`,
        reference: ref,
        occurredAt: creditPay.createdAt,
        userId: creditPay.userId,
      },
    });
  }

  private delegate(entity: SyncEntityName): Delegate {
    const map: Record<SyncEntityName, Delegate> = {
      Company: this.prisma.company as unknown as Delegate,
      Department: this.prisma.department as unknown as Delegate,
      DepartmentPrinterProfile: this.prisma.departmentPrinterProfile as unknown as Delegate,
      PackagingUnit: this.prisma.packagingUnit as unknown as Delegate,
      Store: this.prisma.store as unknown as Delegate,
      Register: this.prisma.register as unknown as Delegate,
      AppRole: this.prisma.appRole as unknown as Delegate,
      User: this.prisma.user as unknown as Delegate,
      UserDepartment: this.prisma.userDepartment as unknown as Delegate,
      ProductFamily: this.prisma.productFamily as unknown as Delegate,
      ProductFamilyTier: this.prisma.productFamilyTier as unknown as Delegate,
      Product: this.prisma.product as unknown as Delegate,
      ProductSaleUnit: this.prisma.productSaleUnit as unknown as Delegate,
      ProductVolumePrice: this.prisma.productVolumePrice as unknown as Delegate,
      ProductRecipe: this.prisma.productRecipe as unknown as Delegate,
      RecipeComponent: this.prisma.recipeComponent as unknown as Delegate,
      ExpenseCategory: this.prisma.expenseCategory as unknown as Delegate,
      CreditCustomer: this.prisma.creditCustomer as unknown as Delegate,
      Sale: this.prisma.sale as unknown as Delegate,
      SaleItem: this.prisma.saleItem as unknown as Delegate,
      SaleDeliveryStop: this.prisma.saleDeliveryStop as unknown as Delegate,
      Payment: this.prisma.payment as unknown as Delegate,
      Delivery: this.prisma.delivery as unknown as Delegate,
      DeliveryItem: this.prisma.deliveryItem as unknown as Delegate,
      DeliveryDrop: this.prisma.deliveryDrop as unknown as Delegate,
      StockMovement: this.prisma.stockMovement as unknown as Delegate,
      FinanceEntry: this.prisma.financeEntry as unknown as Delegate,
      CreditPayment: this.prisma.creditPayment as unknown as Delegate,
      Bank: this.prisma.bank as unknown as Delegate,
      BankAccount: this.prisma.bankAccount as unknown as Delegate,
      BankTransaction: this.prisma.bankTransaction as unknown as Delegate,
      InventorySession: this.prisma.inventorySession as unknown as Delegate,
      InventoryLine: this.prisma.inventoryLine as unknown as Delegate,
      RegisterSession: this.prisma.registerSession as unknown as Delegate,
      ProductionSession: this.prisma.productionSession as unknown as Delegate,
      InternalTransfer: this.prisma.internalTransfer as unknown as Delegate,
      InternalTransferItem: this.prisma.internalTransferItem as unknown as Delegate,
      ProductionFlow: this.prisma.productionFlow as unknown as Delegate,
      PurchaseOrder: this.prisma.purchaseOrder as unknown as Delegate,
      PurchaseOrderLine: this.prisma.purchaseOrderLine as unknown as Delegate,
      GoodsReceipt: this.prisma.goodsReceipt as unknown as Delegate,
      GoodsReceiptLine: this.prisma.goodsReceiptLine as unknown as Delegate,
      CashClosure: this.prisma.cashClosure as unknown as Delegate,
      AuditLog: this.prisma.auditLog as unknown as Delegate,
    };
    return map[entity];
  }
}
