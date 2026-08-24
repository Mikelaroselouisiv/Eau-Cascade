import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsRepository } from './products.repository';

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
  ) {}

  private async resolveCompanyId(explicit?: number) {
    if (explicit) return explicit;
    const c = await this.prisma.company.findFirst({ orderBy: { id: 'asc' } });
    if (!c) {
      throw new BadRequestException('Aucune entreprise configuree');
    }
    return c.id;
  }

  private async assertDepartmentBelongsToCompany(
    departmentId: number | null | undefined,
    companyId: number,
  ) {
    if (departmentId == null) return;
    const d = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!d || d.companyId !== companyId) {
      throw new BadRequestException(
        'Le département doit appartenir à la même entreprise que le produit.',
      );
    }
  }

  private validateVolumeTiers(tiers: { minQuantity: number }[] | undefined) {
    if (!tiers?.length) return;
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

  private validateSaleUnits(dto: CreateProductDto) {
    if (!dto.saleUnits?.length) {
      throw new BadRequestException('Au moins une unité de vente (type : caisse, bouteille…) est requise.');
    }
    const defaults = dto.saleUnits.filter((u) => u.isDefault);
    if (defaults.length > 1) {
      throw new BadRequestException('Une seule unité peut être marquée comme défaut.');
    }
    for (const su of dto.saleUnits) {
      this.validateVolumeTiers(su.volumePrices);
    }
  }

  private async assertPackagingUnitsBelongToDepartment(
    packagingUnitIds: number[],
    departmentId: number,
  ) {
    const units = await this.prisma.packagingUnit.findMany({
      where: { id: { in: packagingUnitIds } },
    });
    if (units.length !== packagingUnitIds.length) {
      throw new BadRequestException('Un ou plusieurs conditionnements sont introuvables.');
    }
    for (const u of units) {
      if (u.departmentId !== departmentId) {
        throw new BadRequestException(
          `Le conditionnement « ${u.label} » (${u.code}) doit appartenir au même département que le produit.`,
        );
      }
    }
  }

  private async assertFamilyBelongsToCompany(
    productFamilyId: number | null | undefined,
    companyId: number,
  ) {
    if (productFamilyId == null) return;
    const f = await this.prisma.productFamily.findFirst({
      where: { id: productFamilyId, deletedAt: null },
    });
    if (!f || f.companyId !== companyId) {
      throw new BadRequestException(
        'La famille de produits doit appartenir à la même entreprise que le produit.',
      );
    }
  }

  async create(createProductDto: CreateProductDto, userId?: number) {
    this.validateSaleUnits(createProductDto);
    const companyId = await this.resolveCompanyId(createProductDto.companyId);
    await this.assertDepartmentBelongsToCompany(createProductDto.departmentId ?? null, companyId);
    await this.assertFamilyBelongsToCompany(createProductDto.productFamilyId ?? null, companyId);
    if (createProductDto.departmentId == null) {
      throw new BadRequestException(
        'Un département est requis pour rattacher les conditionnements de vente au produit.',
      );
    }
    await this.assertPackagingUnitsBelongToDepartment(
      createProductDto.saleUnits.map((u) => u.packagingUnitId),
      createProductDto.departmentId,
    );
    const isService = createProductDto.isService ?? false;
    const trackStock = createProductDto.trackStock ?? !isService;

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          company: { connect: { id: companyId } },
          department: { connect: { id: createProductDto.departmentId } },
          ...(createProductDto.productFamilyId
            ? { productFamily: { connect: { id: createProductDto.productFamilyId } } }
            : {}),
          name: createProductDto.name,
          cardColor: createProductDto.cardColor,
          ...(userId != null ? { createdBy: { connect: { id: userId } } } : {}),
          sku: createProductDto.sku,
          barcode: createProductDto.barcode,
          description: createProductDto.description,
          isService,
          trackStock,
          cost: createProductDto.cost ?? 0,
          stock: 0,
          stockMin: createProductDto.stockMin ?? 0,
        },
      });

      const defaultIndex = createProductDto.saleUnits.findIndex((u) => u.isDefault);
      for (let i = 0; i < createProductDto.saleUnits.length; i++) {
        const su = createProductDto.saleUnits[i];
        const isDefault = defaultIndex >= 0 ? i === defaultIndex : i === 0;
        const ups = su.unitsPerPackage ?? 1;
        await tx.productSaleUnit.create({
          data: {
            productId: product.id,
            packagingUnitId: su.packagingUnitId,
            labelOverride: su.labelOverride,
            unitsPerPackage: ups,
            salePrice: su.salePrice,
            isDefault,
            volumePrices: {
              create:
                su.volumePrices?.map((vp, idx) => ({
                  minQuantity: vp.minQuantity,
                  unitPrice: vp.unitPrice,
                  sortOrder: idx,
                })) ?? [],
            },
          },
        });
      }

      const result = await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        include: {
          department: true,
          productFamily: {
            include: {
              tiers: {
                where: { deletedAt: null },
                orderBy: { minQuantity: 'asc' },
              },
            },
          },
          saleUnits: {
            include: {
              packagingUnit: true,
              volumePrices: { orderBy: { minQuantity: 'asc' } },
            },
          },
          company: { select: { id: true, name: true, currency: true } },
        },
      });
      await this.auditService.log({
        userId,
        action: 'PRODUCT_CREATED',
        entity: 'Product',
        entityId: String(product.id),
        metadata: { name: product.name },
      });
      return result;
    });
  }

  async findAll(departmentId?: number, asOf?: string) {
    const products = await this.productsRepository.findAll(departmentId);
    if (!asOf?.trim()) return products;
    return this.inventoryService.applyStockAsOf(products, asOf.trim());
  }

  async update(id: number, updateProductDto: UpdateProductDto, userId?: number) {
    const existingProduct = await this.productsRepository.findById(id);
    if (!existingProduct) {
      throw new NotFoundException('Product not found');
    }
    const nextCompanyId =
      updateProductDto.companyId !== undefined
        ? updateProductDto.companyId
        : existingProduct.companyId;
    const nextDeptId =
      updateProductDto.departmentId === undefined
        ? existingProduct.departmentId
        : updateProductDto.departmentId;
    await this.assertDepartmentBelongsToCompany(nextDeptId, nextCompanyId);
    if (updateProductDto.productFamilyId !== undefined) {
      await this.assertFamilyBelongsToCompany(updateProductDto.productFamilyId, nextCompanyId);
    }

    const { salePrice, volumePrices, packagingUnitId, labelOverride, productFamilyId, ...productFields } =
      updateProductDto;

    const data: Prisma.ProductUpdateInput = {
      name: productFields.name,
      company:
        productFields.companyId !== undefined
          ? { connect: { id: productFields.companyId } }
          : undefined,
      department:
        productFields.departmentId === null
          ? { disconnect: true }
          : productFields.departmentId !== undefined
            ? { connect: { id: productFields.departmentId } }
            : undefined,
      productFamily:
        productFamilyId === null
          ? { disconnect: true }
          : productFamilyId !== undefined
            ? { connect: { id: productFamilyId } }
            : undefined,
      sku: productFields.sku,
      barcode: productFields.barcode,
      description: productFields.description,
      cardColor: productFields.cardColor !== undefined ? productFields.cardColor : undefined,
      ...(userId != null ? { updatedBy: { connect: { id: userId } } } : {}),
      isService: productFields.isService,
      trackStock: productFields.trackStock,
      cost: productFields.cost,
      stock: productFields.stock,
      stockMin: productFields.stockMin,
    };

    return this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data });

      if (salePrice !== undefined || volumePrices !== undefined) {
        if (volumePrices !== undefined) {
          this.validateVolumeTiers(volumePrices);
        }
        const su =
          (await tx.productSaleUnit.findFirst({
            where: { productId: id, isDefault: true },
            orderBy: { id: 'asc' },
          })) ??
          (await tx.productSaleUnit.findFirst({
            where: { productId: id },
            orderBy: { id: 'asc' },
          }));
        if (su) {
          if (salePrice !== undefined) {
            await tx.productSaleUnit.update({
              where: { id: su.id },
              data: { salePrice },
            });
          }
          if (volumePrices !== undefined) {
            await tx.productVolumePrice.deleteMany({ where: { productSaleUnitId: su.id } });
            if (volumePrices.length) {
              await tx.productVolumePrice.createMany({
                data: volumePrices.map((vp, idx) => ({
                  productSaleUnitId: su.id,
                  minQuantity: vp.minQuantity,
                  unitPrice: vp.unitPrice,
                  sortOrder: idx,
                })),
              });
            }
          }
        }
      }

      if (packagingUnitId !== undefined || labelOverride !== undefined) {
        if (nextDeptId == null) {
          throw new BadRequestException(
            'Un département est requis pour rattacher le conditionnement au produit.',
          );
        }
        if (packagingUnitId !== undefined) {
          await this.assertPackagingUnitsBelongToDepartment([packagingUnitId], nextDeptId);
        }
        const suPack =
          (await tx.productSaleUnit.findFirst({
            where: { productId: id, isDefault: true },
            orderBy: { id: 'asc' },
          })) ??
          (await tx.productSaleUnit.findFirst({
            where: { productId: id },
            orderBy: { id: 'asc' },
          }));
        if (suPack) {
          const lo =
            labelOverride !== undefined
              ? labelOverride === null || String(labelOverride).trim() === ''
                ? null
                : String(labelOverride).trim()
              : undefined;
          await tx.productSaleUnit.update({
            where: { id: suPack.id },
            data: {
              ...(packagingUnitId !== undefined
                ? { packagingUnit: { connect: { id: packagingUnitId } } }
                : {}),
              ...(labelOverride !== undefined ? { labelOverride: lo } : {}),
            },
          });
        }
      }

      const result = await tx.product.findUniqueOrThrow({
        where: { id },
        include: {
          department: true,
          productFamily: {
            include: {
              tiers: {
                where: { deletedAt: null },
                orderBy: { minQuantity: 'asc' },
              },
            },
          },
          saleUnits: {
            include: {
              packagingUnit: true,
              volumePrices: { orderBy: { minQuantity: 'asc' } },
            },
          },
          company: { select: { id: true, name: true, currency: true } },
        },
      });
      await this.auditService.log({
        userId,
        action: 'PRODUCT_UPDATED',
        entity: 'Product',
        entityId: String(id),
        metadata: { name: result.name },
      });
      return result;
    });
  }

  async remove(id: number, userId?: number) {
    const existing = await this.productsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Produit introuvable');
    }
    const sold = await this.prisma.saleItem.count({ where: { productId: id } });
    if (sold > 0) {
      throw new BadRequestException(
        'Impossible de supprimer : ce produit figure déjà dans des ventes.',
      );
    }
    const deleted = await this.prisma.product.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ...(userId != null ? { updatedBy: { connect: { id: userId } } } : {}),
      },
    });
    await this.auditService.log({
      userId,
      action: 'PRODUCT_DELETED',
      entity: 'Product',
      entityId: String(id),
      metadata: { name: existing.name },
    });
    return deleted;
  }
}
