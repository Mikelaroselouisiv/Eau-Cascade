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
  }) {
    const createdAt: Prisma.DateTimeFilter | undefined =
      opts.createdAtGte != null || opts.createdAtLte != null
        ? {
            ...(opts.createdAtGte != null ? { gte: opts.createdAtGte } : {}),
            ...(opts.createdAtLte != null ? { lte: opts.createdAtLte } : {}),
          }
        : undefined;

    const productWhere: Prisma.ProductWhereInput = {
      companyId: opts.companyId,
      ...(opts.departmentId != null && opts.departmentId > 0
        ? { departmentId: opts.departmentId }
        : {}),
    };

    const where: Prisma.SaleWhereInput = {
      deletedAt: null,
      status: 'COMPLETED',
      items: { some: { product: productWhere, deletedAt: null } },
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

  findOne(id: number) {
    return this.prisma.sale.findFirst({
      where: { id, deletedAt: null },
      include: saleInclude,
    });
  }
}
