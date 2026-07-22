import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventorySessionKind, RegisterSessionStatus } from '@prisma/client';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import { ymdToBusinessDayEnd, ymdToBusinessDayStart } from '../../common/utils/business-timezone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import type { CloseRegisterSessionDto, OpenRegisterSessionDto } from './dto/register-session.dto';

const SESSION_INCLUDE = {
  register: { include: { store: true, department: true } },
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
} as const;

const REGISTER_INCLUDE = {
  store: true,
  department: true,
} as const;

@Injectable()
export class RegisterSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  listRegisters(filters?: { companyId?: number; departmentId?: number }) {
    const companyId = filters?.companyId;
    const departmentId = filters?.departmentId;
    return this.prisma.register.findMany({
      where: {
        deletedAt: null,
        ...(companyId ? { store: { companyId } } : {}),
        ...(departmentId
          ? {
              OR: [{ departmentId }, { departmentId: null }],
            }
          : {}),
      },
      include: REGISTER_INCLUDE,
      orderBy: { code: 'asc' },
    });
  }

  private async ensureCompanyStore(companyId: number) {
    const existing = await this.prisma.store.findFirst({
      where: { companyId, deletedAt: null },
      orderBy: { id: 'asc' },
    });
    if (existing) return existing;
    return this.prisma.store.create({
      data: { companyId, name: 'Principal', address: '' },
    });
  }

  async ensureDefaultRegister(companyId: number) {
    const existing = await this.prisma.register.findFirst({
      where: { store: { companyId }, deletedAt: null },
      include: REGISTER_INCLUDE,
    });
    if (existing) return existing;

    const store = await this.ensureCompanyStore(companyId);
    return this.prisma.register.create({
      data: { storeId: store.id, code: `CAISSE-${companyId}` },
      include: REGISTER_INCLUDE,
    });
  }

  async createRegister(input: { companyId: number; departmentId: number; code: string }) {
    const dept = await this.prisma.department.findFirst({
      where: { id: input.departmentId, companyId: input.companyId, deletedAt: null },
    });
    if (!dept) {
      throw new NotFoundException('Département introuvable pour cette entreprise');
    }

    const raw = input.code.trim();
    if (!raw) {
      throw new BadRequestException('Indiquez un numéro ou un nom de caisse.');
    }

    const uniqueCode = `D${input.departmentId}-${raw}`;
    const clash = await this.prisma.register.findFirst({
      where: { code: uniqueCode, deletedAt: null },
    });
    if (clash) {
      throw new BadRequestException('Une caisse avec ce numéro existe déjà pour ce département.');
    }

    const store = await this.ensureCompanyStore(input.companyId);
    return this.prisma.register.create({
      data: {
        storeId: store.id,
        departmentId: input.departmentId,
        code: uniqueCode,
      },
      include: REGISTER_INCLUDE,
    });
  }

  getActiveSessionForUser(userId: number) {
    return this.prisma.registerSession.findFirst({
      where: { openedById: userId, status: RegisterSessionStatus.OPEN, deletedAt: null },
      include: SESSION_INCLUDE,
      orderBy: { openedAt: 'desc' },
    });
  }

  getOpenSessionForRegister(registerId: number) {
    return this.prisma.registerSession.findFirst({
      where: { registerId, status: RegisterSessionStatus.OPEN, deletedAt: null },
      include: SESSION_INCLUDE,
    });
  }

  listSessions(filters?: {
    companyId?: number;
    departmentId?: number;
    registerId?: number;
    openedById?: number;
    status?: RegisterSessionStatus;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: 'openedAt' | 'userName';
    sortDir?: 'asc' | 'desc';
    take?: number;
  }) {
    const take = Math.min(200, Math.max(1, filters?.take ?? 50));
    const where: {
      deletedAt: null;
      registerId?: number;
      openedById?: number;
      status?: RegisterSessionStatus;
      departmentId?: number;
      department?: { companyId: number };
      openedAt?: { gte?: Date; lte?: Date };
    } = { deletedAt: null };

    if (filters?.registerId) where.registerId = filters.registerId;
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
        /* ignore invalid dateFrom */
      }
    }
    if (filters?.dateTo?.trim()) {
      try {
        openedAt.lte = ymdToBusinessDayEnd(filters.dateTo.trim());
      } catch {
        /* ignore invalid dateTo */
      }
    }
    if (openedAt.gte || openedAt.lte) where.openedAt = openedAt;

    const dir = filters?.sortDir === 'asc' ? 'asc' : 'desc';
    if (filters?.sortBy === 'userName') {
      return this.prisma.registerSession.findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy: [{ openedBy: { fullName: dir } }, { openedAt: 'desc' }],
        take,
      });
    }

    return this.prisma.registerSession.findMany({
      where,
      include: SESSION_INCLUDE,
      orderBy: { openedAt: dir },
      take,
    });
  }

  getSession(id: number) {
    return this.prisma.registerSession.findFirst({
      where: { id, deletedAt: null },
      include: SESSION_INCLUDE,
    });
  }

  async openSession(dto: OpenRegisterSessionDto, userId: number) {
    const dept = await this.prisma.department.findUnique({
      where: { id: dto.departmentId },
    });
    if (!dept) {
      throw new NotFoundException('Département introuvable');
    }

    const register = await this.prisma.register.findUnique({
      where: { id: dto.registerId },
      include: { store: true },
    });
    if (!register || register.deletedAt) {
      throw new NotFoundException('Comptoir introuvable');
    }
    if (register.store.companyId !== dept.companyId) {
      throw new BadRequestException('Cette caisse n’appartient pas à l’entreprise du département.');
    }
    if (register.departmentId != null && register.departmentId !== dto.departmentId) {
      throw new BadRequestException('Cette caisse n’est pas rattachée à ce département.');
    }

    const opener = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, companyId: true, departmentId: true },
    });
    if (!opener) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    if (opener.role === 'CASHIER' || opener.role === 'LIVREUR') {
      if (opener.companyId == null || opener.companyId !== dept.companyId) {
        throw new ForbiddenException(
          'Vous n’êtes pas affecté à cette entreprise pour ouvrir la caisse',
        );
      }
      if (opener.departmentId != null && opener.departmentId !== dto.departmentId) {
        throw new ForbiddenException(
          'Vous n’êtes pas affecté à ce département pour ouvrir la caisse',
        );
      }
      if (register.store.companyId !== opener.companyId) {
        throw new ForbiddenException(
          'Ce comptoir n’appartient pas à votre entreprise',
        );
      }
    }

    const existingUser = await this.getActiveSessionForUser(userId);
    if (existingUser) {
      throw new BadRequestException('Vous avez déjà une caisse ouverte.');
    }

    const existingRegister = await this.getOpenSessionForRegister(dto.registerId);
    if (existingRegister) {
      throw new BadRequestException('Ce comptoir est déjà ouvert.');
    }

    const openingInventory = await this.inventoryService.createRegisterInventorySession(
      dto.departmentId,
      InventorySessionKind.OPENING,
      dto.lines,
      userId,
    );

    const session = await this.prisma.registerSession.create({
      data: {
        registerId: dto.registerId,
        departmentId: dto.departmentId,
        openedById: userId,
        openingCashAmount: dto.openingCashAmount ?? null,
        openingInventorySessionId: openingInventory.id,
      },
      include: SESSION_INCLUDE,
    });

    await this.auditService.log({
      userId,
      action: 'REGISTER_SESSION_OPENED',
      entity: 'RegisterSession',
      entityId: String(session.id),
      metadata: { registerId: dto.registerId, departmentId: dto.departmentId },
    });

    return session;
  }

  async closeSession(sessionId: number, dto: CloseRegisterSessionDto, userId: number) {
    const session = await this.prisma.registerSession.findFirst({
      where: { id: sessionId, deletedAt: null },
    });
    if (!session) {
      throw new NotFoundException('Session introuvable');
    }
    if (session.status !== RegisterSessionStatus.OPEN) {
      throw new BadRequestException('Cette caisse est déjà fermée.');
    }
    if (session.openedById !== userId) {
      throw new BadRequestException('Seul l’utilisateur ayant ouvert la caisse peut la fermer.');
    }

    const closingInventory = await this.inventoryService.createRegisterInventorySession(
      session.departmentId,
      InventorySessionKind.CLOSING,
      dto.lines,
      userId,
    );

    const cashVariance = dto.closingCashCounted - dto.closingCashExpected;

    const closed = await this.prisma.registerSession.update({
      where: { id: sessionId },
      data: {
        status: RegisterSessionStatus.CLOSED,
        closedById: userId,
        closedAt: new Date(),
        closingCashExpected: dto.closingCashExpected,
        closingCashCounted: dto.closingCashCounted,
        cashVariance,
        closingInventorySessionId: closingInventory.id,
      },
      include: SESSION_INCLUDE,
    });

    await this.prisma.cashClosure.create({
      data: {
        registerId: session.registerId,
        expectedAmount: dto.closingCashExpected,
        countedAmount: dto.closingCashCounted,
        variance: cashVariance,
        createdById: userId,
      },
    });

    await this.auditService.log({
      userId,
      action: 'REGISTER_SESSION_CLOSED',
      entity: 'RegisterSession',
      entityId: String(sessionId),
      metadata: { cashVariance },
    });

    return closed;
  }
}
