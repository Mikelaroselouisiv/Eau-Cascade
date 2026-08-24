import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const productInclude = {
  department: true,
  productFamily: {
    include: {
      tiers: {
        where: { deletedAt: null },
        orderBy: { minQuantity: 'asc' as const },
      },
    },
  },
  saleUnits: {
    include: {
      packagingUnit: true,
      volumePrices: { orderBy: { minQuantity: 'asc' as const } },
    },
  },
  company: { select: { id: true, name: true, currency: true } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ProductCreateInput) {
    return this.prisma.product.create({
      data,
      include: productInclude,
    });
  }

  findAll(departmentId?: number) {
    return this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(departmentId !== undefined ? { departmentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: productInclude,
    });
  }

  findById(id: number) {
    return this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: productInclude,
    });
  }

  update(id: number, data: Prisma.ProductUpdateInput) {
    return this.prisma.product.update({
      where: { id },
      data,
      include: productInclude,
    });
  }
}
