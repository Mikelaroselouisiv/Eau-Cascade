import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DepartmentKind,
  InventorySessionKind,
  Prisma,
  ProductNature,
  ProductionFlowKind,
  ProductionSessionStatus,
} from '@prisma/client';
import { isProductionDepartment } from '../../common/department-kind';
import { USER_ATTRIBUTION_SELECT, formatUserAttribution } from '../../common/user-attribution';
import { canAccessAssignedDepartment } from '../../common/user-scope';
import { ymdToBusinessDayEnd, ymdToBusinessDayStart } from '../../common/utils/business-timezone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import type {
  CloseProductionSessionDto,
  OpenProductionSessionDto,
} from './dto/production-session.dto';

const SESSION_INCLUDE = {
  department: { include: { company: true } },
  openedBy: { select: USER_ATTRIBUTION_SELECT },
  closedBy: { select: USER_ATTRIBUTION_SELECT },
  openingInventorySession: {
    include: {
      lines: { include: { product: true }, orderBy: { product: { name: 'asc' } } },
    },
  },
  closingInventorySession: {
    include: {
      lines: { include: { product: true }, orderBy: { product: { name: 'asc' } } },
    },
  },
  flows: {
    include: { product: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

@Injectable()
export class ProductionSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  getOpenSessionForDepartment(departmentId: number) {
    return this.prisma.productionSession.findFirst({
      where: { departmentId, status: ProductionSessionStatus.OPEN, deletedAt: null },
      include: SESSION_INCLUDE,
    });
  }

  getActiveSessionForUser(userId: number) {
    return this.prisma.productionSession.findFirst({
      where: { openedById: userId, status: ProductionSessionStatus.OPEN, deletedAt: null },
      include: SESSION_INCLUDE,
      orderBy: { openedAt: 'desc' },
    });
  }

  async getContext(
    user: {
      id: number;
      role?: string | null;
      departmentId?: number | null;
      departmentIds?: number[] | null;
    },
    deviceId: string,
    departmentId?: number,
  ) {
    let mine = await this.getActiveSessionForUser(user.id);
    if (mine && !mine.openedDeviceId) {
      mine = await this.claimSession(mine.id, { deviceId }, user);
    }
    const occupancy =
      departmentId != null ? await this.getOpenSessionForDepartment(departmentId) : null;
    const local =
      mine && mine.openedDeviceId && mine.openedDeviceId === deviceId.trim() ? mine : null;
    const mineElsewhere = mine && !local ? mine : null;
    return {
      local: local ? this.withUsage(local) : null,
      mineElsewhere: mineElsewhere ? this.withUsage(mineElsewhere) : null,
      occupancy: occupancy ? this.withUsage(occupancy) : null,
    };
  }

  async claimSession(
    sessionId: number,
    dto: { deviceId: string; deviceName?: string },
    user: Parameters<ProductionSessionsService['assertDeptAccess']>[0],
  ) {
    const session = await this.prisma.productionSession.findFirst({
      where: { id: sessionId, deletedAt: null },
    });
    if (!session) throw new NotFoundException('Session introuvable');
    if (session.status !== ProductionSessionStatus.OPEN) {
      throw new BadRequestException('Cette production est déjà fermée.');
    }
    if (session.openedById !== user.id) {
      throw new BadRequestException('Seul l’utilisateur ayant ouvert la production peut la reprendre.');
    }
    this.assertDeptAccess(user, session.departmentId);

    const claimed = await this.prisma.productionSession.update({
      where: { id: sessionId },
      data: {
        openedDeviceId: dto.deviceId.trim(),
        openedDeviceName: dto.deviceName?.trim() || null,
      },
      include: SESSION_INCLUDE,
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PRODUCTION_SESSION_CLAIMED',
      entity: 'ProductionSession',
      entityId: String(sessionId),
    });

    return claimed;
  }

  async requireOpenSessionTx(tx: Prisma.TransactionClient, departmentId: number) {
    const session = await tx.productionSession.findFirst({
      where: { departmentId, status: ProductionSessionStatus.OPEN, deletedAt: null },
      select: { id: true },
    });
    if (!session) {
      throw new BadRequestException('Ouvrez la production avant d’écouler du produit fini.');
    }
    return session;
  }

  async recordFlowTx(
    tx: Prisma.TransactionClient,
    data: {
      departmentId: number;
      productId: number;
      kind: ProductionFlowKind;
      quantity: number;
      userId?: number;
      productionSessionId?: number | null;
      internalTransferId?: number | null;
      donationId?: number | null;
      deliveryId?: number | null;
    },
  ) {
    const qty = Number(data.quantity);
    if (!Number.isFinite(qty) || Math.abs(qty) <= 0.0001) return null;
    return tx.productionFlow.create({
      data: {
        departmentId: data.departmentId,
        productId: data.productId,
        kind: data.kind,
        quantity: Math.abs(qty),
        productionSessionId: data.productionSessionId ?? null,
        internalTransferId: data.internalTransferId ?? null,
        donationId: data.donationId ?? null,
        deliveryId: data.deliveryId ?? null,
        createdById: data.userId ?? null,
      },
    });
  }

  private usageFromInventory(session: {
    openingInventorySession?: {
      lines: Array<{
        productId: number;
        countedQty: Prisma.Decimal | number | null;
        product: { id: number; name: string };
      }>;
    } | null;
    closingInventorySession?: {
      lines: Array<{
        productId: number;
        countedQty: Prisma.Decimal | number | null;
      }>;
    } | null;
  }) {
    const openingLines = session.openingInventorySession?.lines ?? [];
    const closingByProduct = new Map(
      (session.closingInventorySession?.lines ?? []).map((l) => [
        l.productId,
        Number(l.countedQty ?? 0),
      ]),
    );
    const closed = session.closingInventorySession != null;
    return openingLines.map((l) => {
      const opened = Number(l.countedQty ?? 0);
      const remaining = closed ? (closingByProduct.get(l.productId) ?? 0) : opened;
      return {
        productId: l.productId,
        name: l.product.name,
        openedQty: opened,
        remainingQty: remaining,
        usedQty: closed ? Math.max(0, opened - remaining) : 0,
      };
    });
  }

  private outflowFromFlows(session: {
    flows?: Array<{
      kind: ProductionFlowKind;
      quantity: Prisma.Decimal | number;
      product: { id: number; name: string };
    }>;
  }) {
    const byProduct = new Map<
      number,
      { productId: number; name: string; toClients: number; toDepartments: number; toDonations: number; received: number }
    >();
    for (const flow of session.flows ?? []) {
      const row = byProduct.get(flow.product.id) ?? {
        productId: flow.product.id,
        name: flow.product.name,
        toClients: 0,
        toDepartments: 0,
        toDonations: 0,
        received: 0,
      };
      const qty = Number(flow.quantity);
      if (flow.kind === ProductionFlowKind.FLOW_CLIENT) row.toClients += qty;
      else if (flow.kind === ProductionFlowKind.FLOW_TRANSFER_OUT) row.toDepartments += qty;
      else if (flow.kind === ProductionFlowKind.FLOW_DONATION) row.toDonations += qty;
      else if (flow.kind === ProductionFlowKind.TRANSFER_IN) row.received += qty;
      byProduct.set(flow.product.id, row);
    }
    return [...byProduct.values()]
      .map((row) => ({
        ...row,
        produced: row.toClients + row.toDepartments + row.toDonations,
      }))
      .filter((row) => row.produced > 0.0001 || row.received > 0.0001)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }

  private withUsage<T extends Parameters<ProductionSessionsService['usageFromInventory']>[0] &
    Parameters<ProductionSessionsService['outflowFromFlows']>[0]>(session: T) {
    return {
      ...session,
      usage: this.usageFromInventory(session),
      outflow: this.outflowFromFlows(session),
    };
  }

  private holderText(session: {
    openedBy?: { fullName?: string | null; phone?: string | null; email?: string | null } | null;
    openedDeviceName?: string | null;
  }) {
    const who = formatUserAttribution(session.openedBy);
    const device = session.openedDeviceName?.trim();
    return device ? `${who} · ${device}` : who;
  }

  private assertDeptAccess(
    user: {
      id: number;
      role?: string | null;
      departmentId?: number | null;
      departmentIds?: number[] | null;
    },
    departmentId: number,
  ) {
    if (!canAccessAssignedDepartment(user, departmentId)) {
      throw new ForbiddenException('Vous n’êtes pas affecté à ce département.');
    }
  }

  async getCountSheet(departmentId: number, user: Parameters<ProductionSessionsService['assertDeptAccess']>[0]) {
    this.assertDeptAccess(user, departmentId);
    const dept = await this.prisma.department.findFirst({
      where: { id: departmentId, deletedAt: null },
    });
    if (!dept || !isProductionDepartment(dept.kind)) {
      throw new BadRequestException('Ce département n’est pas une unité de production.');
    }
    return this.inventoryService.getCountSheetContext(departmentId, undefined, false, {
      nature: ProductNature.RAW_MATERIAL,
    });
  }

  async openSession(
    dto: OpenProductionSessionDto,
    user: Parameters<ProductionSessionsService['assertDeptAccess']>[0],
  ) {
    this.assertDeptAccess(user, dto.departmentId);
    const dept = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, deletedAt: null },
    });
    if (!dept) throw new NotFoundException('Département introuvable');
    if (dept.kind !== DepartmentKind.PRODUCTION_DISTRIBUTION) {
      throw new BadRequestException('Ce département n’est pas une unité de production.');
    }

    const existingUser = await this.getActiveSessionForUser(user.id);
    if (existingUser) {
      throw new BadRequestException('Vous avez déjà une production ouverte.');
    }
    const existingDept = await this.getOpenSessionForDepartment(dto.departmentId);
    if (existingDept) {
      throw new BadRequestException(
        `La production est déjà ouverte (${this.holderText(existingDept)}).`,
      );
    }

    const openingInventory = await this.inventoryService.createRegisterInventorySession(
      dto.departmentId,
      InventorySessionKind.OPENING,
      dto.lines ?? [],
      user.id,
      {
        natures: [ProductNature.RAW_MATERIAL],
        labelPrefix: 'Ouverture production',
        adjustStock: true,
        allowEmpty: true,
      },
    );

    const session = await this.prisma.productionSession.create({
      data: {
        departmentId: dto.departmentId,
        openedById: user.id,
        openedDeviceId: dto.deviceId.trim(),
        openedDeviceName: dto.deviceName?.trim() || null,
        openingInventorySessionId: openingInventory.id,
      },
      include: SESSION_INCLUDE,
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PRODUCTION_SESSION_OPENED',
      entity: 'ProductionSession',
      entityId: String(session.id),
      metadata: { departmentId: dto.departmentId },
    });

    return session;
  }

  async closeSession(
    sessionId: number,
    dto: CloseProductionSessionDto,
    user: Parameters<ProductionSessionsService['assertDeptAccess']>[0],
  ) {
    const session = await this.prisma.productionSession.findFirst({
      where: { id: sessionId, deletedAt: null },
    });
    if (!session) throw new NotFoundException('Session introuvable');
    if (session.status !== ProductionSessionStatus.OPEN) {
      throw new BadRequestException('Cette production est déjà fermée.');
    }
    if (session.openedById !== user.id && user.role !== 'ADMIN') {
      throw new BadRequestException('Seul l’utilisateur ayant ouvert la production peut la fermer.');
    }
    this.assertDeptAccess(user, session.departmentId);

    const closingInventory = await this.inventoryService.createRegisterInventorySession(
      session.departmentId,
      InventorySessionKind.CLOSING,
      dto.lines ?? [],
      user.id,
      {
        natures: [ProductNature.RAW_MATERIAL],
        labelPrefix: 'Fermeture production',
        adjustStock: true,
        allowEmpty: true,
      },
    );

    const closed = await this.prisma.productionSession.update({
      where: { id: sessionId },
      data: {
        status: ProductionSessionStatus.CLOSED,
        closedById: user.id,
        closedAt: new Date(),
        note: dto.note?.trim() || null,
        closingInventorySessionId: closingInventory.id,
      },
      include: SESSION_INCLUDE,
    });
    const withUsage = this.withUsage(closed);

    await this.auditService.log({
      userId: user.id,
      action: 'PRODUCTION_SESSION_CLOSED',
      entity: 'ProductionSession',
      entityId: String(sessionId),
      metadata: { usage: withUsage.usage },
    });

    return withUsage;
  }

  listSessions(filters?: {
    companyId?: number;
    departmentId?: number;
    openedById?: number;
    status?: ProductionSessionStatus;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: 'openedAt' | 'userName';
    sortDir?: 'asc' | 'desc';
    take?: number;
  }) {
    const take = Math.min(200, Math.max(1, filters?.take ?? 50));
    const where: Prisma.ProductionSessionWhereInput = { deletedAt: null };

    if (filters?.openedById) where.openedById = filters.openedById;
    if (filters?.status) where.status = filters.status;
    if (filters?.departmentId) where.departmentId = filters.departmentId;
    if (filters?.companyId) {
      where.department = { companyId: filters.companyId };
    }

    const openedAt: { gte?: Date; lte?: Date } = {};
    if (filters?.dateFrom?.trim()) {
      try {
        openedAt.gte = ymdToBusinessDayStart(filters.dateFrom.trim());
      } catch {
        /* ignore */
      }
    }
    if (filters?.dateTo?.trim()) {
      try {
        openedAt.lte = ymdToBusinessDayEnd(filters.dateTo.trim());
      } catch {
        /* ignore */
      }
    }
    if (openedAt.gte || openedAt.lte) where.openedAt = openedAt;

    const dir = filters?.sortDir === 'asc' ? 'asc' : 'desc';
    return this.prisma.productionSession
      .findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy:
          filters?.sortBy === 'userName'
            ? [{ openedBy: { fullName: dir } }, { openedAt: 'desc' }]
            : { openedAt: dir },
        take,
      })
      .then((rows) => rows.map((row) => this.withUsage(row)));
  }

  async getSession(id: number) {
    const session = await this.prisma.productionSession.findFirst({
      where: { id, deletedAt: null },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new NotFoundException('Session introuvable');
    return this.withUsage(session);
  }
}
