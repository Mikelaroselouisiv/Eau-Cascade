import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export async function resolveProductInDepartment(
  tx: Prisma.TransactionClient,
  source: {
    id: number;
    name: string;
    sku: string | null;
    companyId: number;
    departmentId: number | null;
  },
  targetDepartmentId: number,
): Promise<number> {
  if (source.departmentId === targetDepartmentId) return source.id;
  const sku = source.sku?.trim();
  if (sku) {
    const bySku = await tx.product.findFirst({
      where: {
        companyId: source.companyId,
        departmentId: targetDepartmentId,
        sku,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (bySku) return bySku.id;
  }
  const byName = await tx.product.findFirst({
    where: {
      companyId: source.companyId,
      departmentId: targetDepartmentId,
      name: source.name,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (byName) return byName.id;
  throw new BadRequestException(
    `Le produit « ${source.name} » n’existe pas dans le département destinataire. Créez-le dans ce département.`,
  );
}
