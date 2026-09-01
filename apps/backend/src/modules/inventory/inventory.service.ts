import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DepartmentKind, InventorySessionKind, InventorySessionStatus, MovementType, Prisma, ProductNature } from '@prisma/client';
import { isProductionDepartment } from '../../common/department-kind';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import { canAccessAssignedDepartment } from '../../common/user-scope';
import { ymdToDateEnd, ymdToDateStart } from '../../common/time/timezone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RolesService } from '../roles/roles.service';
import { permissionGranted } from '../../common/permissions';
import type { UpdateInventoryLineDto } from './dto/physical-inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rolesService: RolesService,
  ) {}

  /**
   * Interprète `asOf` : YYYY-MM-DD → fin de journée Port-au-Prince ;
   * sinon ISO / datetime parseable → instant UTC.
   */
  parseAsOfInstant(asOfRaw: string): Date {
    const raw = asOfRaw.trim();
    if (!raw) {
      throw new BadRequestException('asOf est requis.');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      try {
        return ymdToDateEnd(raw);
      } catch {
        throw new BadRequestException('asOf invalide (attendu YYYY-MM-DD).');
      }
    }
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) {
      throw new BadRequestException('asOf invalide (attendu YYYY-MM-DD ou ISO).');
    }
    return d;
  }

  /** Delta signé d’un mouvement (IN/ADJUSTMENT +, OUT −). */
  private signedMovementDelta(type: MovementType, quantity: Prisma.Decimal | number): number {
    const q = Number(quantity);
    if (!Number.isFinite(q)) return 0;
    return type === MovementType.OUT ? -q : q;
  }

  /**
   * Somme des deltas de mouvements strictement après `asOf`, par produit.
   * stock(T) = stock actuel − somme des deltas après T.
   */
  async sumSignedDeltasAfter(
    asOf: Date,
    productIds: number[],
  ): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (productIds.length === 0) return map;

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        productId: { in: productIds },
        createdAt: { gt: asOf },
        deletedAt: null,
      },
      select: { productId: true, type: true, quantity: true },
    });

    for (const m of movements) {
      const delta = this.signedMovementDelta(m.type, m.quantity);
      map.set(m.productId, (map.get(m.productId) ?? 0) + delta);
    }
    return map;
  }

  /** Remplace `stock` par le stock rétrospectif à `asOf` (lecture seule). */
  async applyStockAsOf<T extends { id: number; stock: Prisma.Decimal | number | string }>(
    products: T[],
    asOfRaw: string,
  ): Promise<Array<T & { stock: number }>> {
    const asOf = this.parseAsOfInstant(asOfRaw);
    const ids = products.map((p) => p.id);
    const deltas = await this.sumSignedDeltasAfter(asOf, ids);
    return products.map((p) => {
      const current = Number(p.stock);
      const after = deltas.get(p.id) ?? 0;
      return { ...p, stock: current - after };
    });
  }

  async ensureStockAvailability(productId: number, quantity: number) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    if (Number(product.stock) < quantity) {
      throw new BadRequestException(`Stock insuffisant pour ${product.name}`);
    }
    return product;
  }

  async ensureStockAvailabilityTx(
    tx: Prisma.TransactionClient,
    productId: number,
    quantity: number,
  ) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    if (Number(product.stock) < quantity) {
      throw new BadRequestException(`Stock insuffisant pour ${product.name}`);
    }
    return product;
  }

  async decrementStockTx(
    tx: Prisma.TransactionClient,
    productId: number,
    quantity: number,
    createdById?: number,
    reason = 'Sale',
  ) {
    await tx.product.update({
      where: { id: productId },
      data: { stock: { decrement: quantity } },
    });
    await tx.stockMovement.create({
      data: {
        productId,
        quantity,
        type: MovementType.OUT,
        reason,
        createdById,
      },
    });
  }

  async increaseStock(
    productId: number,
    quantity: number,
    reason?: string,
    createdById?: number,
    actor?: {
      role?: string | null;
      departmentId?: number | null;
      departmentIds?: number[] | null;
    },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { department: { select: { id: true, kind: true } } },
    });
    if (!product) {
      throw new NotFoundException('Produit introuvable');
    }
    if (actor?.role) {
      const perms = await this.rolesService.getPermissionsForUserRole(actor.role);
      const fullStock =
        permissionGranted(perms, 'stock.manage') || permissionGranted(perms, 'stock.adjust');
      if (!fullStock) {
        if (product.nature !== ProductNature.RAW_MATERIAL) {
          throw new ForbiddenException('Uniquement les matières premières.');
        }
        if (product.department?.kind !== DepartmentKind.PRODUCTION_DISTRIBUTION) {
          throw new BadRequestException(
            'Les matières premières s’enregistrent sur une unité de production.',
          );
        }
        if (!canAccessAssignedDepartment(actor, product.departmentId)) {
          throw new ForbiddenException('Vous n’êtes pas affecté à cette usine.');
        }
      }
    }
    await this.prisma.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity } },
    });
    const movement = await this.prisma.stockMovement.create({
      data: {
        productId,
        quantity,
        type: MovementType.IN,
        reason: reason ?? 'Stock entry',
        createdById,
      },
      include: { product: true },
    });
    await this.auditService.log({
      userId: createdById,
      action: 'STOCK_IN',
      entity: 'StockMovement',
      entityId: String(movement.id),
      metadata: { productId, quantity, reason: movement.reason },
    });
    return movement;
  }

  async adjustStock(productId: number, quantity: number, reason?: string, createdById?: number) {
    await this.ensureProductExists(productId);
    if (quantity === 0) {
      throw new BadRequestException('La quantité doit être non nulle.');
    }
    if (quantity < 0) {
      const abs = Math.abs(quantity);
      await this.ensureStockAvailability(productId, abs);
    }
    await this.prisma.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity } },
    });
    const abs = Math.abs(quantity);
    const movement = await this.prisma.stockMovement.create({
      data: {
        productId,
        quantity: abs,
        type: quantity < 0 ? MovementType.OUT : MovementType.ADJUSTMENT,
        reason: reason ?? (quantity < 0 ? 'Sortie manuelle' : 'Ajustement manuel'),
        createdById,
      },
      include: { product: true },
    });
    await this.auditService.log({
      userId: createdById,
      action: quantity < 0 ? 'STOCK_OUT' : 'STOCK_ADJUST',
      entity: 'StockMovement',
      entityId: String(movement.id),
      metadata: { productId, quantity, reason: movement.reason },
    });
    return movement;
  }

  private readonly movementsInclude = {
    product: {
      include: {
        saleUnits: {
          where: { isDefault: true },
          take: 1,
          include: { packagingUnit: true },
        },
      },
    },
    createdBy: { select: USER_ATTRIBUTION_SELECT },
    inventorySession: { select: { id: true, label: true, departmentId: true } },
    goodsReceipt: { select: { id: true, departmentId: true, status: true } },
  } satisfies Prisma.StockMovementInclude;

  /**
   * Journal des mouvements (ventes = OUT, réceptions, ajustements…), paginé pour éviter de tout charger.
   */
  async getMovements(opts?: {
    skip?: number;
    take?: number;
    companyId?: number;
    /** Tri par date : plus récent d'abord (défaut) ou plus ancien d'abord. */
    order?: 'asc' | 'desc';
    /** Bornes inclusives YYYY-MM-DD (Port-au-Prince). */
    dateFrom?: string;
    dateTo?: string;
  }) {
    const skip = Math.max(0, Math.floor(opts?.skip ?? 0));
    const rawTake = opts?.take ?? 100;
    const take = Math.min(500, Math.max(1, Math.floor(rawTake)));
    const orderDir = opts?.order === 'asc' ? 'asc' : 'desc';

    const where: Prisma.StockMovementWhereInput = {
      deletedAt: null,
    };

    if (opts?.companyId) {
      where.product = { companyId: opts.companyId };
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (opts?.dateFrom?.trim()) {
      try {
        createdAt.gte = ymdToDateStart(opts.dateFrom.trim());
      } catch {
        throw new BadRequestException('dateFrom invalide (attendu YYYY-MM-DD).');
      }
    }
    if (opts?.dateTo?.trim()) {
      try {
        createdAt.lte = ymdToDateEnd(opts.dateTo.trim());
      } catch {
        throw new BadRequestException('dateTo invalide (attendu YYYY-MM-DD).');
      }
    }
    if (createdAt.gte || createdAt.lte) {
      if (createdAt.gte && createdAt.lte && createdAt.gte > createdAt.lte) {
        throw new BadRequestException('dateFrom doit être antérieure ou égale à dateTo.');
      }
      where.createdAt = createdAt;
    }

    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        include: this.movementsInclude,
        orderBy: { createdAt: orderDir },
        skip,
        take,
        where,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return { items, total };
  }

  getLowStockAlerts(
    threshold = 5,
    companyId?: number,
    opts?: { skip?: number; take?: number },
  ) {
    const skip = Math.max(0, Math.floor(opts?.skip ?? 0));
    const rawTake = opts?.take ?? 10;
    const take = Math.min(200, Math.max(1, Math.floor(rawTake)));
    const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 5;

    // Faible = encore du stock, mais strictement sous le seuil (ex. seuil 5 → 0 < stock < 5).
    // Les stocks à zéro ont leur propre moniteur.
    const where: Prisma.ProductWhereInput = {
      ...this.onHandStockProductWhere(companyId),
      stock: { gt: 0, lt: safeThreshold },
    };

    return Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          saleUnits: { include: { packagingUnit: true } },
          department: true,
        },
        orderBy: { stock: 'asc' },
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]).then(([items, total]) => ({ items, total }));
  }

  getZeroStockAlerts(companyId?: number, opts?: { skip?: number; take?: number }) {
    const skip = Math.max(0, Math.floor(opts?.skip ?? 0));
    const rawTake = opts?.take ?? 8;
    const take = Math.min(200, Math.max(1, Math.floor(rawTake)));

    const where: Prisma.ProductWhereInput = {
      ...this.onHandStockProductWhere(companyId),
      stock: { lte: 0 },
    };

    return Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          saleUnits: { include: { packagingUnit: true } },
          department: true,
        },
        orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]).then(([items, total]) => ({ items, total }));
  }

  /** Stock réellement entreposé : MP, ou PF des magasins DISTRIBUTION (jamais le PF usine). */
  private onHandStockProductWhere(companyId?: number): Prisma.ProductWhereInput {
    return {
      trackStock: true,
      isService: false,
      deletedAt: null,
      ...(companyId ? { companyId } : {}),
      OR: [
        { nature: ProductNature.RAW_MATERIAL },
        {
          AND: [
            { nature: { not: ProductNature.RAW_MATERIAL } },
            { department: { kind: DepartmentKind.DISTRIBUTION } },
          ],
        },
      ],
    };
  }

  private countNatureForDepartment(kind?: DepartmentKind | string | null): ProductNature {
    return isProductionDepartment(kind) ? ProductNature.RAW_MATERIAL : ProductNature.FINISHED_GOOD;
  }

  private async ensureProductExists(productId: number) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    return product;
  }

  async createPhysicalInventorySession(
    departmentId: number,
    label: string | undefined,
    note: string | undefined,
    createdById: number | undefined,
    kind: InventorySessionKind = InventorySessionKind.AD_HOC,
    onlyPositiveStock = false,
  ) {
    const dept = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept) {
      throw new NotFoundException('Département introuvable');
    }

    const products = await this.prisma.product.findMany({
      where: {
        departmentId,
        trackStock: true,
        isService: false,
        nature: this.countNatureForDepartment(dept.kind),
        ...(onlyPositiveStock ? { stock: { gt: 0 } } : {}),
      },
    });

    const dateLabel = new Date().toLocaleDateString('fr-FR');
    const defaultLabels: Record<InventorySessionKind, string> = {
      [InventorySessionKind.OPENING]: `Ouverture de période — ${dateLabel}`,
      [InventorySessionKind.CLOSING]: `Clôture de période — ${dateLabel}`,
      [InventorySessionKind.AD_HOC]: `Contrôle — ${dateLabel}`,
    };

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.inventorySession.create({
        data: {
          departmentId,
          kind,
          label: label?.trim() || defaultLabels[kind],
          note: note ?? null,
          createdById: createdById ?? null,
        },
      });

      if (products.length > 0) {
        await tx.inventoryLine.createMany({
          data: products.map((p) => ({
            sessionId: session.id,
            productId: p.id,
            systemQtyAtOpen: p.stock,
          })),
        });
      }

      const created = await tx.inventorySession.findUniqueOrThrow({
        where: { id: session.id },
        include: {
          department: { include: { company: true } },
          createdBy: { select: USER_ATTRIBUTION_SELECT },
          lines: {
            include: { product: true },
            orderBy: { product: { name: 'asc' } },
          },
        },
      });
      await this.auditService.log({
        userId: createdById,
        action: 'INVENTORY_SESSION_CREATED',
        entity: 'InventorySession',
        entityId: String(session.id),
        metadata: {
          departmentId,
          label: label ?? null,
          onlyPositiveStock,
          lineCount: products.length,
        },
      });
      return created;
    });
  }

  listInventorySessions(filters?: { departmentId?: number; companyId?: number }) {
    const where: Prisma.InventorySessionWhereInput = { deletedAt: null };
    if (filters?.departmentId) {
      where.departmentId = filters.departmentId;
    } else if (filters?.companyId) {
      where.department = { companyId: filters.companyId };
    }
    return this.prisma.inventorySession.findMany({
      where,
      include: {
        department: {
          select: {
            id: true,
            name: true,
            company: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: USER_ATTRIBUTION_SELECT },
        completedBy: { select: USER_ATTRIBUTION_SELECT },
        cancelledBy: { select: USER_ATTRIBUTION_SELECT },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });
  }

  async listInventorySessionsForExport(
    filters?: { departmentId?: number; companyId?: number },
    take = 80,
  ) {
    const safeTake = Math.min(200, Math.max(1, Math.floor(take)));
    const where: Prisma.InventorySessionWhereInput = { deletedAt: null };
    if (filters?.departmentId) {
      where.departmentId = filters.departmentId;
    } else if (filters?.companyId) {
      where.department = { companyId: filters.companyId };
    }
    return this.prisma.inventorySession.findMany({
      where,
      include: {
        department: { include: { company: true } },
        createdBy: { select: USER_ATTRIBUTION_SELECT },
        completedBy: { select: USER_ATTRIBUTION_SELECT },
        lines: {
          include: {
            product: {
              include: {
                saleUnits: {
                  where: { isDefault: true },
                  take: 1,
                  include: { packagingUnit: true },
                },
              },
            },
          },
          orderBy: { product: { name: 'asc' } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: safeTake,
    });
  }

  async getCountSheetContext(
    departmentId: number,
    asOfRaw?: string,
    onlyPositiveStock = false,
    opts?: { nature?: ProductNature },
  ) {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: { company: true },
    });
    if (!department) {
      throw new NotFoundException('Département introuvable');
    }
    const products = await this.prisma.product.findMany({
      where: {
        departmentId,
        trackStock: true,
        isService: false,
        nature: opts?.nature ?? ProductNature.FINISHED_GOOD,
      },
      include: {
        saleUnits: {
          where: { isDefault: true },
          take: 1,
          include: { packagingUnit: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const asOf = asOfRaw?.trim() ? this.parseAsOfInstant(asOfRaw) : null;
    const deltas = asOf
      ? await this.sumSignedDeltasAfter(
          asOf,
          products.map((p) => p.id),
        )
      : null;

    const mapped = products.map((p) => {
      const current = Number(p.stock);
      const stock = deltas ? current - (deltas.get(p.id) ?? 0) : current;
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock,
        unitLabel: this.packagingLabelFromProduct(p),
      };
    });

    return {
      generatedAt: asOf ? asOf.toISOString() : new Date().toISOString(),
      asOf: asOf ? asOf.toISOString() : null,
      department: {
        id: department.id,
        name: department.name,
        company: department.company,
      },
      products: onlyPositiveStock ? mapped.filter((p) => Number(p.stock) > 0) : mapped,
    };
  }

  private packagingLabelFromProduct(product: {
    saleUnits?: Array<{
      labelOverride: string | null;
      packagingUnit: { label: string; code: string };
    }>;
  }): string {
    const su = product.saleUnits?.[0];
    if (!su?.packagingUnit) return '—';
    const override = su.labelOverride?.trim();
    const base = override || su.packagingUnit.label;
    return `${base} (${su.packagingUnit.code})`;
  }

  async getInventorySession(id: number) {
    const s = await this.prisma.inventorySession.findUnique({
      where: { id },
      include: {
        department: { include: { company: true } },
        createdBy: { select: USER_ATTRIBUTION_SELECT },
        completedBy: { select: USER_ATTRIBUTION_SELECT },
        cancelledBy: { select: USER_ATTRIBUTION_SELECT },
        lines: {
          include: { product: true },
          orderBy: { product: { name: 'asc' } },
        },
      },
    });
    if (!s) {
      throw new NotFoundException('Session introuvable');
    }
    return s;
  }

  async updateInventoryLine(
    sessionId: number,
    lineId: number,
    dto: UpdateInventoryLineDto,
    userId?: number,
  ) {
    const line = await this.prisma.inventoryLine.findFirst({
      where: { id: lineId, sessionId },
      include: { session: true },
    });
    if (!line) {
      throw new NotFoundException('Ligne introuvable');
    }
    if (line.session.status !== InventorySessionStatus.DRAFT) {
      throw new BadRequestException('Cette session est verrouillée.');
    }

    const data: Prisma.InventoryLineUpdateInput = {};
    if (dto.countedQty !== undefined) {
      data.countedQty = dto.countedQty;
    }
    if (dto.note !== undefined) {
      data.note = dto.note;
    }

    const updated = await this.prisma.inventoryLine.update({
      where: { id: lineId },
      data,
      include: { product: true },
    });
    await this.auditService.log({
      userId,
      action: 'INVENTORY_LINE_UPDATED',
      entity: 'InventoryLine',
      entityId: String(lineId),
      metadata: { sessionId, countedQty: dto.countedQty, note: dto.note },
    });
    return updated;
  }

  async completeInventorySession(sessionId: number, userId?: number, adjustStock = false) {
    const session = await this.prisma.inventorySession.findUnique({
      where: { id: sessionId },
      include: { lines: true },
    });
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    if (session.status !== InventorySessionStatus.DRAFT) {
      throw new BadRequestException('Cette session est déjà clôturée ou annulée.');
    }

    const hasCount = session.lines.some((l) => l.countedQty !== null);
    if (!hasCount) {
      throw new BadRequestException(
        'Saisissez au moins une quantité comptée avant validation.',
      );
    }

    const reason = `Inventaire physique #${sessionId}`;

    await this.prisma.$transaction(async (tx) => {
      if (adjustStock) {
        for (const line of session.lines) {
          if (line.countedQty === null) {
            continue;
          }
          const counted = Number(line.countedQty);
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product) {
            continue;
          }
          const current = Number(product.stock);
          const delta = counted - current;
          if (delta === 0) {
            continue;
          }

          if (delta < 0) {
            const abs = Math.abs(delta);
            await this.ensureStockAvailabilityTx(tx, line.productId, abs);
            await tx.product.update({
              where: { id: line.productId },
              data: { stock: { increment: delta } },
            });
            await tx.stockMovement.create({
              data: {
                productId: line.productId,
                quantity: abs,
                type: MovementType.OUT,
                reason,
                createdById: userId,
                inventorySessionId: sessionId,
              },
            });
          } else {
            await tx.product.update({
              where: { id: line.productId },
              data: { stock: { increment: delta } },
            });
            await tx.stockMovement.create({
              data: {
                productId: line.productId,
                quantity: delta,
                type: MovementType.IN,
                reason,
                createdById: userId,
                inventorySessionId: sessionId,
              },
            });
          }
        }
      }

      await tx.inventorySession.update({
        where: { id: sessionId },
        data: {
          status: InventorySessionStatus.COMPLETED,
          completedAt: new Date(),
          ...(userId != null ? { completedBy: { connect: { id: userId } } } : {}),
        },
      });
    });

    await this.auditService.log({
      userId,
      action: 'INVENTORY_SESSION_COMPLETED',
      entity: 'InventorySession',
      entityId: String(sessionId),
      metadata: { adjustStock },
    });
    return this.getInventorySession(sessionId);
  }

  async cancelInventorySession(sessionId: number, userId?: number) {
    const session = await this.prisma.inventorySession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    if (session.status !== InventorySessionStatus.DRAFT) {
      throw new BadRequestException('Seules les sessions en brouillon peuvent être annulées.');
    }
    const cancelled = await this.prisma.inventorySession.update({
      where: { id: sessionId },
      data: {
        status: InventorySessionStatus.CANCELLED,
        ...(userId != null ? { cancelledBy: { connect: { id: userId } } } : {}),
      },
    });
    await this.auditService.log({
      userId,
      action: 'INVENTORY_SESSION_CANCELLED',
      entity: 'InventorySession',
      entityId: String(sessionId),
    });
    return cancelled;
  }

  async createRegisterInventorySession(
    departmentId: number,
    kind: InventorySessionKind,
    lines: Array<{ productId: number; countedQty: number }>,
    userId?: number,
    opts?: {
      natures?: ProductNature[];
      labelPrefix?: string;
      allowEmpty?: boolean;
      adjustStock?: boolean;
      skipProductCount?: boolean;
    },
  ) {
    const dept = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept) {
      throw new NotFoundException('Département introuvable');
    }

    const skipProductCount =
      opts?.skipProductCount === true ||
      (opts?.natures == null && isProductionDepartment(dept.kind));

    const natureFilter = opts?.natures?.length
      ? { nature: { in: opts.natures } }
      : { nature: ProductNature.FINISHED_GOOD };

    const products = skipProductCount
      ? []
      : await this.prisma.product.findMany({
          where: {
            departmentId,
            trackStock: true,
            isService: false,
            deletedAt: null,
            ...natureFilter,
          },
        });
    const allowEmpty = opts?.allowEmpty === true || products.length === 0;
    if (products.length === 0 && !allowEmpty) {
      throw new BadRequestException('Aucun produit avec stock suivi dans ce département.');
    }

    const lineMap = new Map(lines.map((l) => [l.productId, l.countedQty]));
    for (const p of products) {
      const qty = lineMap.get(p.id);
      if (qty === undefined || !Number.isFinite(qty) || qty < 0) {
        throw new BadRequestException(`Quantité manquante ou invalide pour ${p.name}.`);
      }
    }

    const dateLabel = new Date().toLocaleDateString('fr-FR');
    const defaultLabels: Record<InventorySessionKind, string> = {
      [InventorySessionKind.OPENING]: `${opts?.labelPrefix ?? 'Ouverture caisse'} — ${dateLabel}`,
      [InventorySessionKind.CLOSING]: `${opts?.labelPrefix ?? 'Fermeture caisse'} — ${dateLabel}`,
      [InventorySessionKind.AD_HOC]: `Contrôle — ${dateLabel}`,
    };

    const sessionId = await this.prisma.$transaction(async (tx) => {
      const session = await tx.inventorySession.create({
        data: {
          departmentId,
          kind,
          label: defaultLabels[kind],
          createdById: userId ?? null,
        },
      });

      if (products.length) {
        await tx.inventoryLine.createMany({
          data: products.map((p) => ({
            sessionId: session.id,
            productId: p.id,
            systemQtyAtOpen: p.stock,
            countedQty: lineMap.get(p.id)!,
          })),
        });
      }

      if (opts?.adjustStock) {
        for (const p of products) {
          const counted = lineMap.get(p.id)!;
          const current = Number(p.stock);
          const delta = counted - current;
          if (Math.abs(delta) <= 0.0001) continue;
          await tx.product.update({
            where: { id: p.id },
            data: { stock: counted },
          });
          await tx.stockMovement.create({
            data: {
              productId: p.id,
              quantity: Math.abs(delta),
              type: delta > 0 ? MovementType.IN : MovementType.OUT,
              reason: defaultLabels[kind],
              createdById: userId ?? null,
              inventorySessionId: session.id,
            },
          });
        }
      }

      await tx.inventorySession.update({
        where: { id: session.id },
        data: {
          status: InventorySessionStatus.COMPLETED,
          completedAt: new Date(),
          ...(userId != null ? { completedBy: { connect: { id: userId } } } : {}),
        },
      });

      return session.id;
    });

    await this.auditService.log({
      userId,
      action: 'INVENTORY_SESSION_COMPLETED',
      entity: 'InventorySession',
      entityId: String(sessionId),
      metadata: { adjustStock: opts?.adjustStock === true, registerFlow: !opts?.natures, kind },
    });

    return this.getInventorySession(sessionId);
  }

  async getGlobalStockSnapshot(filters?: {
    companyIds?: number[];
    departmentIds?: number[];
    /** Stock rétrospectif à cette date (fin de journée PAP si YYYY-MM-DD). */
    asOf?: string;
  }) {
    const where: Prisma.ProductWhereInput = this.onHandStockProductWhere(
      filters?.companyIds?.length === 1 ? filters.companyIds[0] : undefined,
    );

    if (filters?.departmentIds?.length) {
      where.departmentId = { in: filters.departmentIds };
    } else if (filters?.companyIds?.length && filters.companyIds.length !== 1) {
      where.companyId = { in: filters.companyIds };
    }

    const products = await this.prisma.product.findMany({
      where,
      include: {
        department: { include: { company: true } },
        saleUnits: {
          where: { isDefault: true },
          take: 1,
          include: { packagingUnit: true },
        },
      },
      orderBy: [{ company: { name: 'asc' } }, { department: { name: 'asc' } }, { name: 'asc' }],
    });

    const asOf = filters?.asOf?.trim() ? this.parseAsOfInstant(filters.asOf) : null;
    const deltas = asOf
      ? await this.sumSignedDeltasAfter(
          asOf,
          products.map((p) => p.id),
        )
      : null;

    return {
      generatedAt: asOf ? asOf.toISOString() : new Date().toISOString(),
      asOf: asOf ? asOf.toISOString() : null,
      items: products.map((p) => {
        const current = Number(p.stock);
        const stock = deltas ? current - (deltas.get(p.id) ?? 0) : current;
        const stockMin = Number(p.stockMin);
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          stock,
          stockMin,
          company: p.department?.company ?? null,
          department: p.department
            ? { id: p.department.id, name: p.department.name }
            : null,
          unitLabel: this.packagingLabelFromProduct(p),
          lowStock: stock <= stockMin,
        };
      }),
    };
  }
}
