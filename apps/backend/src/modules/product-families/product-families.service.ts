import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateProductFamilyDto,
  ProductFamilyTierDto,
  UpdateProductFamilyDto,
} from './dto/product-family.dto';

const familyInclude = {
  tiers: {
    where: { deletedAt: null },
    orderBy: { minQuantity: 'asc' as const },
  },
  products: {
    where: { deletedAt: null },
    select: {
      id: true,
      uuid: true,
      name: true,
      companyId: true,
      departmentId: true,
    },
    orderBy: { name: 'asc' as const },
  },
} satisfies Prisma.ProductFamilyInclude;

@Injectable()
export class ProductFamiliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private validateTiers(tiers: ProductFamilyTierDto[]) {
    if (!tiers?.length) {
      throw new BadRequestException('Au moins un palier de prix est requis.');
    }
    const seen = new Set<string>();
    for (const t of tiers) {
      const m = Number(t.minQuantity);
      if (!Number.isFinite(m) || m < 0.0001) {
        throw new BadRequestException('Chaque palier doit avoir une quantité minimale > 0.');
      }
      const key = String(m);
      if (seen.has(key)) {
        throw new BadRequestException('Paliers : quantité minimale en double.');
      }
      seen.add(key);
    }
  }

  private async ensureCompany(companyId: number) {
    const c = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Entreprise introuvable');
    return c;
  }

  private async assertProductsBelongToCompany(productIds: number[], companyId: number) {
    if (!productIds.length) return;
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true, companyId: true, name: true },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('Un ou plusieurs produits sont introuvables.');
    }
    for (const p of products) {
      if (p.companyId !== companyId) {
        throw new BadRequestException(
          `Le produit « ${p.name} » n’appartient pas à cette entreprise.`,
        );
      }
    }
  }

  list(companyId: number) {
    return this.prisma.productFamily.findMany({
      where: { companyId, deletedAt: null },
      include: familyInclude,
      orderBy: { name: 'asc' },
    });
  }

  async getById(id: number) {
    const row = await this.prisma.productFamily.findFirst({
      where: { id, deletedAt: null },
      include: familyInclude,
    });
    if (!row) throw new NotFoundException('Famille de produits introuvable');
    return row;
  }

  async create(dto: CreateProductFamilyDto, userId?: number) {
    this.validateTiers(dto.tiers);
    await this.ensureCompany(dto.companyId);
    const productIds = [...new Set((dto.productIds ?? []).map(Number).filter((n) => n > 0))];
    await this.assertProductsBelongToCompany(productIds, dto.companyId);

    const row = await this.prisma.$transaction(async (tx) => {
      const family = await tx.productFamily.create({
        data: {
          companyId: dto.companyId,
          name: dto.name.trim(),
          tiers: {
            create: dto.tiers.map((t, idx) => ({
              minQuantity: t.minQuantity,
              unitPrice: t.unitPrice,
              sortOrder: idx,
            })),
          },
        },
      });
      if (productIds.length) {
        await tx.product.updateMany({
          where: { id: { in: productIds } },
          data: { productFamilyId: family.id },
        });
      }
      return tx.productFamily.findUniqueOrThrow({
        where: { id: family.id },
        include: familyInclude,
      });
    });

    await this.auditService.log({
      userId,
      action: 'PRODUCT_FAMILY_CREATED',
      entity: 'ProductFamily',
      entityId: String(row.id),
      metadata: { name: row.name, companyId: row.companyId },
    });
    return row;
  }

  async update(id: number, dto: UpdateProductFamilyDto, userId?: number) {
    const existing = await this.prisma.productFamily.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Famille de produits introuvable');

    if (dto.tiers !== undefined) this.validateTiers(dto.tiers);

    let productIds: number[] | undefined;
    if (dto.productIds !== undefined) {
      productIds = [...new Set(dto.productIds.map(Number).filter((n) => n > 0))];
      await this.assertProductsBelongToCompany(productIds, existing.companyId);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined) {
        await tx.productFamily.update({
          where: { id },
          data: { name: dto.name.trim() },
        });
      }

      if (dto.tiers !== undefined) {
        await tx.productFamilyTier.deleteMany({ where: { productFamilyId: id } });
        await tx.productFamilyTier.createMany({
          data: dto.tiers.map((t, idx) => ({
            productFamilyId: id,
            minQuantity: t.minQuantity,
            unitPrice: t.unitPrice,
            sortOrder: idx,
          })),
        });
      }

      if (productIds !== undefined) {
        await tx.product.updateMany({
          where: { productFamilyId: id },
          data: { productFamilyId: null },
        });
        if (productIds.length) {
          await tx.product.updateMany({
            where: { id: { in: productIds } },
            data: { productFamilyId: id },
          });
        }
      }

      return tx.productFamily.findUniqueOrThrow({
        where: { id },
        include: familyInclude,
      });
    });

    await this.auditService.log({
      userId,
      action: 'PRODUCT_FAMILY_UPDATED',
      entity: 'ProductFamily',
      entityId: String(id),
      metadata: { name: row.name },
    });
    return row;
  }

  async softDelete(id: number, userId?: number) {
    const existing = await this.prisma.productFamily.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Famille de produits introuvable');

    await this.prisma.$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { productFamilyId: id },
        data: { productFamilyId: null },
      });
      await tx.productFamily.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });

    await this.auditService.log({
      userId,
      action: 'PRODUCT_FAMILY_DELETED',
      entity: 'ProductFamily',
      entityId: String(id),
      metadata: { name: existing.name },
    });
    return { ok: true };
  }
}
