import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const saleInclude = {
  user: { select: { id: true, email: true, phone: true, role: true, fullName: true } },
  items: {
    include: {
      product: { include: { department: { select: { id: true, name: true } } } },
      productSaleUnit: { include: { packagingUnit: true } },
    },
  },
  payments: true,
} satisfies Prisma.SaleInclude;

@Injectable()
export class SalesRepository {
  constructor(private readonly prisma: PrismaService) {}

  createWithTx(tx: Prisma.TransactionClient, data: Prisma.SaleCreateInput) {
    return tx.sale.create({
      data,
      include: saleInclude,
    });
  }

  findAll() {
    return this.prisma.sale.findMany({
      where: { deletedAt: null },
      include: saleInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  findManyPaginated(opts: {
    companyId: number;
    skip: number;
    take: number;
    createdAtGte?: Date;
    createdAtLte?: Date;
    departmentId?: number;
    departmentIds?: number[];
    /** ADMIN : tombstones (deletedAt) inclus, toujours status COMPLETED. */
    includeDeleted?: boolean;
  }) {
    const createdAt: Prisma.DateTimeFilter | undefined =
      opts.createdAtGte != null || opts.createdAtLte != null
        ? {
            ...(opts.createdAtGte != null ? { gte: opts.createdAtGte } : {}),
            ...(opts.createdAtLte != null ? { lte: opts.createdAtLte } : {}),
          }
        : undefined;

    const scopedDeptIds =
      opts.departmentIds?.filter((id) => Number.isFinite(id) && id > 0) ??
      (opts.departmentId != null && opts.departmentId > 0 ? [opts.departmentId] : []);

    const productWhere: Prisma.ProductWhereInput = {
      companyId: opts.companyId,
      ...(scopedDeptIds.length === 1
        ? { departmentId: scopedDeptIds[0] }
        : scopedDeptIds.length > 1
          ? { departmentId: { in: scopedDeptIds } }
          : {}),
    };

    const where: Prisma.SaleWhereInput = {
      status: 'COMPLETED',
      items: {
        some: {
          product: productWhere,
          ...(opts.includeDeleted ? {} : { deletedAt: null }),
        },
      },
      ...(opts.includeDeleted ? {} : { deletedAt: null }),
      ...(createdAt ? { createdAt } : {}),
    };

    return Promise.all([
      this.prisma.sale.findMany({
        where,
        include: saleInclude,
        orderBy: { createdAt: 'desc' },
        skip: opts.skip,
        take: opts.take,
      }),
      this.prisma.sale.count({ where }),
    ]).then(([items, total]) => ({ items, total }));
  }

  findOne(id: number, opts?: { includeDeleted?: boolean }) {
    return this.prisma.sale.findFirst({
      where: { id, ...(opts?.includeDeleted ? {} : { deletedAt: null }) },
      include: saleInclude,
    });
  }
}
