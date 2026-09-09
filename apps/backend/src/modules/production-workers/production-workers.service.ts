import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductNature, ProductionFlowKind } from '@prisma/client';
import { isProductionDepartment } from '../../common/department-kind';
import { permissionGranted } from '../../common/permissions';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import { canAccessAssignedDepartment } from '../../common/user-scope';
import { ymdToBusinessDayEnd, ymdToBusinessDayStart } from '../../common/utils/business-timezone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { ProductionSessionsService } from '../production-sessions/production-sessions.service';
import { RolesService } from '../roles/roles.service';
import type {
  CreateProductionWorkerDto,
  DeclareWorkerMovementDto,
  UpdateProductionWorkerDto,
} from './dto/production-worker.dto';

const WORKER_INCLUDE = {
  department: { select: { id: true, name: true, kind: true } },
  company: { select: { id: true, name: true } },
} as const;

const MOVEMENT_INCLUDE = {
  worker: { select: { id: true, name: true, phone: true, payrollCoefficient: true } },
  product: { select: { id: true, name: true, nature: true } },
  createdBy: { select: USER_ATTRIBUTION_SELECT },
} as const;

type ScopeUser = {
  id: number;
  role?: string | null;
  companyId?: number | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
};

@Injectable()
export class ProductionWorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
    private readonly productionSessions: ProductionSessionsService,
    private readonly rolesService: RolesService,
  ) {}

  private async canSeePayroll(user: ScopeUser) {
    if (!user.role) return false;
    const perms = await this.rolesService.getPermissionsForUserRole(user.role);
    return permissionGranted(perms, 'workers.manage');
  }

  private assertDeptAccess(user: ScopeUser, departmentId: number) {
    if (!canAccessAssignedDepartment(user, departmentId)) {
      throw new ForbiddenException('Vous n’êtes pas affecté à ce département.');
    }
  }

  private normalizePhone(phone: string) {
    return phone.trim();
  }

  private dateFilter(dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter | undefined {
    const createdAt: Prisma.DateTimeFilter = {};
    if (dateFrom?.trim()) {
      try {
        createdAt.gte = ymdToBusinessDayStart(dateFrom.trim());
      } catch {
        /* ignore */
      }
    }
    if (dateTo?.trim()) {
      try {
        createdAt.lte = ymdToBusinessDayEnd(dateTo.trim());
      } catch {
        /* ignore */
      }
    }
    return createdAt.gte || createdAt.lte ? createdAt : undefined;
  }

  private async loadWorkerForMovement(dto: DeclareWorkerMovementDto, user: ScopeUser) {
    this.assertDeptAccess(user, dto.departmentId);
    const worker = await this.prisma.productionWorker.findFirst({
      where: { id: dto.workerId, deletedAt: null },
    });
    if (!worker) throw new NotFoundException('Ouvrier introuvable');
    if (!worker.isActive) throw new BadRequestException('Ouvrier inactif');
    if (worker.departmentId !== dto.departmentId) {
      throw new BadRequestException('L’ouvrier n’appartient pas à ce département.');
    }
    const dept = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, deletedAt: null },
    });
    if (!dept) throw new NotFoundException('Département introuvable');
    if (!isProductionDepartment(dept.kind)) {
      throw new BadRequestException('Ce département n’est pas une unité de production.');
    }
    return { worker, dept };
  }

  async listWorkers(
    departmentId: number,
    user: ScopeUser,
    opts?: { includeInactive?: boolean },
  ) {
    this.assertDeptAccess(user, departmentId);
    const workers = await this.prisma.productionWorker.findMany({
      where: {
        departmentId,
        deletedAt: null,
        ...(opts?.includeInactive ? {} : { isActive: true }),
      },
      include: WORKER_INCLUDE,
      orderBy: { name: 'asc' },
    });

    const session = await this.productionSessions.getOpenSessionForDepartment(departmentId);
    const sessionId = session?.id;
    const ids = workers.map((w) => w.id);
    const [issued, returned] =
      ids.length === 0 || sessionId == null
        ? [[], []]
        : await Promise.all([
            this.prisma.productionWorkerIssue.groupBy({
              by: ['workerId'],
              where: { workerId: { in: ids }, departmentId, productionSessionId: sessionId },
              _sum: { quantity: true },
            }),
            this.prisma.productionWorkerOutput.groupBy({
              by: ['workerId'],
              where: { workerId: { in: ids }, departmentId, productionSessionId: sessionId },
              _sum: { quantity: true, payrollAmount: true },
            }),
          ]);
    const issuedBy = new Map(issued.map((g) => [g.workerId, g]));
    const returnedBy = new Map(returned.map((g) => [g.workerId, g]));

    const showPay = await this.canSeePayroll(user);
    return workers.map((w) => {
      const out = returnedBy.get(w.id);
      const row = {
        ...w,
        sessionIssuedQty: Number(issuedBy.get(w.id)?._sum.quantity ?? 0),
        sessionQuantity: Number(out?._sum.quantity ?? 0),
      };
      if (!showPay) {
        return { ...row, payrollCoefficient: 0, sessionPayroll: 0 };
      }
      return {
        ...row,
        payrollCoefficient: Number(w.payrollCoefficient),
        sessionPayroll: Number(out?._sum.payrollAmount ?? 0),
      };
    });
  }

  async getWorker(
    id: number,
    user: ScopeUser,
    opts?: { dateFrom?: string; dateTo?: string },
  ) {
    const worker = await this.prisma.productionWorker.findFirst({
      where: { id, deletedAt: null },
      include: WORKER_INCLUDE,
    });
    if (!worker) throw new NotFoundException('Ouvrier introuvable');
    this.assertDeptAccess(user, worker.departmentId);

    const createdAt = this.dateFilter(opts?.dateFrom, opts?.dateTo);
    const where = { workerId: id, ...(createdAt ? { createdAt } : {}) };
    const [issues, outputs] = await Promise.all([
      this.prisma.productionWorkerIssue.findMany({
        where,
        include: MOVEMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.productionWorkerOutput.findMany({
        where,
        include: MOVEMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    const mpByProduct = new Map<number, { productId: number; name: string; quantity: number }>();
    for (const row of issues) {
      const cur = mpByProduct.get(row.productId) ?? {
        productId: row.productId,
        name: row.product.name,
        quantity: 0,
      };
      cur.quantity += Number(row.quantity);
      mpByProduct.set(row.productId, cur);
    }
    const pfByProduct = new Map<number, { productId: number; name: string; quantity: number }>();
    for (const row of outputs) {
      const cur = pfByProduct.get(row.productId) ?? {
        productId: row.productId,
        name: row.product.name,
        quantity: 0,
      };
      cur.quantity += Number(row.quantity);
      pfByProduct.set(row.productId, cur);
    }

    const payrollAmount = outputs.reduce((s, r) => s + Number(r.payrollAmount), 0);
    const finishedQty = outputs.reduce((s, r) => s + Number(r.quantity), 0);

    return {
      ...worker,
      payrollCoefficient: Number(worker.payrollCoefficient),
      dateFrom: opts?.dateFrom ?? null,
      dateTo: opts?.dateTo ?? null,
      issuedQty: issues.reduce((s, r) => s + Number(r.quantity), 0),
      finishedQty,
      payrollAmount,
      issuedByProduct: [...mpByProduct.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
      finishedByProduct: [...pfByProduct.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
      issues: issues.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
      })),
      outputs: outputs.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        payrollAmount: Number(r.payrollAmount),
      })),
    };
  }

  async createWorker(dto: CreateProductionWorkerDto, user: ScopeUser) {
    this.assertDeptAccess(user, dto.departmentId);
    const dept = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, deletedAt: null },
    });
    if (!dept) throw new NotFoundException('Département introuvable');
    if (!isProductionDepartment(dept.kind)) {
      throw new BadRequestException('Ce département n’est pas une unité de production.');
    }

    const phone = this.normalizePhone(dto.phone);
    const duplicate = await this.prisma.productionWorker.findFirst({
      where: { companyId: dept.companyId, phone, deletedAt: null },
    });
    if (duplicate) {
      throw new BadRequestException('Un ouvrier avec ce téléphone existe déjà.');
    }

    const row = await this.prisma.productionWorker.create({
      data: {
        companyId: dept.companyId,
        departmentId: dto.departmentId,
        name: dto.name.trim(),
        phone,
        payrollCoefficient: dto.payrollCoefficient,
        createdById: user.id,
      },
      include: WORKER_INCLUDE,
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PRODUCTION_WORKER_CREATED',
      entity: 'ProductionWorker',
      entityId: String(row.id),
      metadata: { departmentId: dto.departmentId },
    });

    return {
      ...row,
      payrollCoefficient: Number(row.payrollCoefficient),
      sessionIssuedQty: 0,
      sessionQuantity: 0,
      sessionPayroll: 0,
    };
  }

  async updateWorker(id: number, dto: UpdateProductionWorkerDto, user: ScopeUser) {
    const existing = await this.prisma.productionWorker.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Ouvrier introuvable');
    this.assertDeptAccess(user, existing.departmentId);

    if (dto.phone != null) {
      const phone = this.normalizePhone(dto.phone);
      const duplicate = await this.prisma.productionWorker.findFirst({
        where: {
          companyId: existing.companyId,
          phone,
          deletedAt: null,
          NOT: { id },
        },
      });
      if (duplicate) {
        throw new BadRequestException('Un ouvrier avec ce téléphone existe déjà.');
      }
    }

    const row = await this.prisma.productionWorker.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.phone != null ? { phone: this.normalizePhone(dto.phone) } : {}),
        ...(dto.payrollCoefficient != null ? { payrollCoefficient: dto.payrollCoefficient } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: WORKER_INCLUDE,
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PRODUCTION_WORKER_UPDATED',
      entity: 'ProductionWorker',
      entityId: String(id),
    });

    return { ...row, payrollCoefficient: Number(row.payrollCoefficient) };
  }

  async listIssues(departmentId: number, user: ScopeUser, workerId?: number) {
    this.assertDeptAccess(user, departmentId);
    const session = await this.productionSessions.getOpenSessionForDepartment(departmentId);
    const rows = await this.prisma.productionWorkerIssue.findMany({
      where: {
        departmentId,
        ...(workerId ? { workerId } : {}),
        ...(session ? { productionSessionId: session.id } : {}),
      },
      include: MOVEMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const showPay = await this.canSeePayroll(user);
    return rows.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
      worker: showPay
        ? r.worker
        : { id: r.worker.id, name: r.worker.name, phone: r.worker.phone, payrollCoefficient: 0 },
    }));
  }

  async listOutputs(departmentId: number, user: ScopeUser, workerId?: number) {
    this.assertDeptAccess(user, departmentId);
    const session = await this.productionSessions.getOpenSessionForDepartment(departmentId);
    const rows = await this.prisma.productionWorkerOutput.findMany({
      where: {
        departmentId,
        ...(workerId ? { workerId } : {}),
        ...(session ? { productionSessionId: session.id } : {}),
      },
      include: MOVEMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const showPay = await this.canSeePayroll(user);
    return rows.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
      payrollAmount: showPay ? Number(r.payrollAmount) : 0,
      worker: showPay
        ? r.worker
        : { id: r.worker.id, name: r.worker.name, phone: r.worker.phone, payrollCoefficient: 0 },
    }));
  }

  async declareIssue(dto: DeclareWorkerMovementDto, user: ScopeUser) {
    const { worker } = await this.loadWorkerForMovement(dto, user);
    const productIds = dto.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException('Produit en double dans l’enregistrement.');
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const item of dto.items) {
      const p = byId.get(item.productId);
      if (!p) throw new NotFoundException(`Produit ${item.productId} introuvable`);
      if (p.companyId !== worker.companyId) {
        throw new BadRequestException(`« ${p.name} » n’appartient pas à cette entreprise.`);
      }
      if (p.nature !== ProductNature.RAW_MATERIAL) {
        throw new BadRequestException(`« ${p.name} » n’est pas une matière première.`);
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const session = await this.productionSessions.requireOpenSessionTx(tx, dto.departmentId);
      const createdIds: number[] = [];
      for (const item of dto.items) {
        const p = byId.get(item.productId)!;
        const qty = Number(item.quantity);
        await this.inventoryService.ensureStockAvailabilityTx(tx, p.id, qty);
        const row = await tx.productionWorkerIssue.create({
          data: {
            workerId: worker.id,
            departmentId: dto.departmentId,
            productId: p.id,
            quantity: qty,
            productionSessionId: session.id,
            createdById: user.id,
          },
        });
        await this.inventoryService.decrementStockTx(
          tx,
          p.id,
          qty,
          user.id,
          `MP ouvrier ${worker.name}`,
        );
        createdIds.push(row.id);
      }
      return tx.productionWorkerIssue.findMany({
        where: { id: { in: createdIds } },
        include: MOVEMENT_INCLUDE,
        orderBy: { id: 'asc' },
      });
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PRODUCTION_WORKER_ISSUE',
      entity: 'ProductionWorkerIssue',
      entityId: String(created[0]?.id ?? dto.workerId),
      metadata: { workerId: dto.workerId, departmentId: dto.departmentId },
    });

    return created.map((r) => ({ ...r, quantity: Number(r.quantity) }));
  }

  async declareOutput(dto: DeclareWorkerMovementDto, user: ScopeUser) {
    const { worker } = await this.loadWorkerForMovement(dto, user);
    const productIds = dto.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException('Produit en double dans l’enregistrement.');
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const item of dto.items) {
      const p = byId.get(item.productId);
      if (!p) throw new NotFoundException(`Produit ${item.productId} introuvable`);
      if (p.companyId !== worker.companyId) {
        throw new BadRequestException(`« ${p.name} » n’appartient pas à cette entreprise.`);
      }
      if (p.nature === ProductNature.RAW_MATERIAL) {
        throw new BadRequestException(`« ${p.name} » est une matière première.`);
      }
    }

    const coefficient = Number(worker.payrollCoefficient);
    const created = await this.prisma.$transaction(async (tx) => {
      const session = await this.productionSessions.requireOpenSessionTx(tx, dto.departmentId);
      const createdIds: number[] = [];
      for (const item of dto.items) {
        const qty = Number(item.quantity);
        const output = await tx.productionWorkerOutput.create({
          data: {
            workerId: worker.id,
            departmentId: dto.departmentId,
            productId: item.productId,
            quantity: qty,
            payrollAmount: qty * coefficient,
            productionSessionId: session.id,
            createdById: user.id,
          },
        });
        await this.productionSessions.recordFlowTx(tx, {
          departmentId: dto.departmentId,
          productId: item.productId,
          kind: ProductionFlowKind.PRODUCED,
          quantity: qty,
          userId: user.id,
          productionSessionId: session.id,
          workerOutputId: output.id,
        });
        createdIds.push(output.id);
      }
      return tx.productionWorkerOutput.findMany({
        where: { id: { in: createdIds } },
        include: MOVEMENT_INCLUDE,
        orderBy: { id: 'asc' },
      });
    });

    await this.auditService.log({
      userId: user.id,
      action: 'PRODUCTION_WORKER_OUTPUT',
      entity: 'ProductionWorkerOutput',
      entityId: String(created[0]?.id ?? dto.workerId),
      metadata: { workerId: dto.workerId, departmentId: dto.departmentId },
    });

    return created.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
      payrollAmount: Number(r.payrollAmount),
    }));
  }
}
