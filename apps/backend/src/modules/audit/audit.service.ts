import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import { ymdToBusinessDayEnd, ymdToBusinessDayStart } from '../../common/utils/business-timezone';
import { PrismaService } from '../../prisma/prisma.service';

type AuditInput = {
  userId?: number;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: unknown;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId,
          metadata: input.metadata as object | undefined,
        },
      });
    } catch (err) {
      console.error('[AuditService] log failed:', err);
    }
  }

  async list(opts?: {
    skip?: number;
    take?: number;
    entity?: string;
    action?: string;
    userId?: number;
    departmentId?: number;
    companyId?: number;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const skip = Math.max(0, Math.floor(opts?.skip ?? 0));
    const take = Math.min(200, Math.max(1, Math.floor(opts?.take ?? 50)));
    const where: Prisma.AuditLogWhereInput = {};

    if (opts?.entity?.trim()) {
      where.entity = opts.entity.trim();
    }
    if (opts?.action?.trim()) {
      where.action = { contains: opts.action.trim(), mode: 'insensitive' };
    }
    if (opts?.userId != null && Number.isFinite(opts.userId)) {
      where.userId = opts.userId;
    }

    const userFilter: Prisma.UserWhereInput = {};
    if (opts?.departmentId != null && Number.isFinite(opts.departmentId)) {
      userFilter.departmentId = opts.departmentId;
    }
    if (opts?.companyId != null && Number.isFinite(opts.companyId)) {
      userFilter.companyId = opts.companyId;
    }
    if (Object.keys(userFilter).length > 0) {
      where.user = userFilter;
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (opts?.dateFrom?.trim()) {
      try {
        createdAt.gte = ymdToBusinessDayStart(opts.dateFrom.trim());
      } catch {
        /* ignore invalid dateFrom */
      }
    }
    if (opts?.dateTo?.trim()) {
      try {
        createdAt.lte = ymdToBusinessDayEnd(opts.dateTo.trim());
      } catch {
        /* ignore invalid dateTo */
      }
    }
    if (createdAt.gte || createdAt.lte) {
      where.createdAt = createdAt;
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: USER_ATTRIBUTION_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
