import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BankTransactionType, FinanceType, MovementType, PaymentMethod, Prisma } from '@prisma/client';
import { permissionsSatisfy } from '../../common/permissions';
import { resolveFamilyUnitPrice, resolveVolumeUnitPrice } from '../../common/utils/volume-unit-price';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AuditService } from '../audit/audit.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { InventoryService } from '../inventory/inventory.service';
import { RolesService } from '../roles/roles.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { SalesRepository } from './sales.repository';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesRepository: SalesRepository,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
    private readonly deliveriesService: DeliveriesService,
    private readonly rolesService: RolesService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  async create(
    createSaleDto: CreateSaleDto,
    userId?: number,
    role?: string,
  ) {
    const isSpecialSale =
      !!createSaleDto.specialSale ||
      createSaleDto.items.some((it) => it.unitPrice != null);

    if (isSpecialSale) {
      const perms = role ? await this.rolesService.getPermissionsForUserRole(role) : [];
      if (!permissionsSatisfy(perms, ['sales.special_price'])) {
        throw new ForbiddenException(
          'Vente spéciale réservée aux rôles autorisés (permission sales.special_price)',
        );
      }
      for (const item of createSaleDto.items) {
        if (item.unitPrice == null || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) {
          throw new BadRequestException(
            'Chaque ligne de vente spéciale doit avoir un prix unitaire',
          );
        }
      }
    }

    if (createSaleDto.clientUuid) {
      const existing = await this.prisma.sale.findUnique({
        where: { clientUuid: createSaleDto.clientUuid },
        select: { id: true, txnNumber: true },
      });
      if (existing) return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      if (createSaleDto.clientUuid) {
        const raced = await tx.sale.findUnique({
          where: { clientUuid: createSaleDto.clientUuid },
          select: { id: true, txnNumber: true },
        });
        if (raced) return raced;
      }

      const saleItemsData: Prisma.SaleItemCreateWithoutSaleInput[] = [];
      let total = 0;
      let firstCompanyId: number | null = null;
      let firstDepartmentId: number | null = null;

      const loadedLines: Array<{
        item: (typeof createSaleDto.items)[number];
        psu: {
          id: number;
          salePrice: Prisma.Decimal;
          labelOverride: string | null;
          unitsPerPackage: Prisma.Decimal;
          product: {
            id: number;
            companyId: number;
            departmentId: number | null;
            name: string;
            isService: boolean;
            trackStock: boolean;
            productFamilyId: number | null;
            productFamily: {
              tiers: { minQuantity: Prisma.Decimal; unitPrice: Prisma.Decimal }[];
            } | null;
          };
          packagingUnit: { label: string };
          volumePrices: { minQuantity: Prisma.Decimal; unitPrice: Prisma.Decimal }[];
        };
        baseQuantity: number;
      }> = [];

      for (const item of createSaleDto.items) {
        const psu = await tx.productSaleUnit.findUnique({
          where: { id: item.productSaleUnitId },
          include: {
            product: {
              include: {
                productFamily: {
                  include: {
                    tiers: {
                      where: { deletedAt: null },
                      orderBy: { minQuantity: 'asc' },
                    },
                  },
                },
              },
            },
            packagingUnit: true,
            volumePrices: { orderBy: { minQuantity: 'asc' } },
          },
        });
        if (!psu) {
          throw new NotFoundException(`Unité de vente ${item.productSaleUnitId} introuvable`);
        }

        const product = psu.product;
        if (firstCompanyId === null) {
          firstCompanyId = product.companyId;
        }
        if (firstDepartmentId === null && product.departmentId != null) {
          firstDepartmentId = product.departmentId;
        }
        const unitsPerPackage = Number(psu.unitsPerPackage);
        const baseQuantity = unitsPerPackage * item.quantity;

        const recipe = product.isService
          ? await tx.productRecipe.findUnique({
              where: { parentProductId: product.id },
              include: { components: true },
            })
          : null;

        if (product.isService && recipe?.components.length) {
          for (const c of recipe.components) {
            const need = Number(c.quantityPerParentBaseUnit) * baseQuantity;
            await this.inventoryService.ensureStockAvailabilityTx(
              tx,
              c.componentProductId,
              need,
            );
          }
        } else if (product.trackStock && !product.isService) {
          await this.inventoryService.ensureStockAvailabilityTx(
            tx,
            product.id,
            baseQuantity,
          );
        }

        loadedLines.push({ item, psu, baseQuantity });
      }

      const familyQty = new Map<number, number>();
      if (!isSpecialSale) {
        for (const line of loadedLines) {
          const fid = line.psu.product.productFamilyId;
          if (fid == null) continue;
          familyQty.set(fid, (familyQty.get(fid) ?? 0) + Number(line.item.quantity));
        }
      }

      for (const line of loadedLines) {
        const { item, psu, baseQuantity } = line;
        const product = psu.product;
        const tierRows = psu.volumePrices.map((v) => ({
          minQuantity: Number(v.minQuantity),
          unitPrice: Number(v.unitPrice),
        }));
        let unitPrice: number;
        if (isSpecialSale) {
          unitPrice = Number(item.unitPrice);
        } else {
          const fid = product.productFamilyId;
          const familyTiers =
            product.productFamily?.tiers.map((t) => ({
              minQuantity: Number(t.minQuantity),
              unitPrice: Number(t.unitPrice),
            })) ?? [];
          const familyPrice =
            fid != null
              ? resolveFamilyUnitPrice(familyTiers, familyQty.get(fid) ?? 0)
              : null;
          unitPrice =
            familyPrice != null
              ? familyPrice
              : resolveVolumeUnitPrice(Number(psu.salePrice), tierRows, item.quantity);
        }
        const subtotal = unitPrice * item.quantity;
        total += subtotal;

        const lineLabel = psu.labelOverride
          ? `${product.name} (${psu.labelOverride})`
          : `${product.name} (${psu.packagingUnit.label})`;

        // Stock : contrôle de dispo à l’encaissement, sortie réelle à la livraison.
        saleItemsData.push({
          quantity: item.quantity,
          baseQuantity,
          unitPrice,
          subtotal,
          lineLabel,
          product: { connect: { id: product.id } },
          productSaleUnit: { connect: { id: psu.id } },
        });
      }

      for (const p of createSaleDto.payments) {
        if (p.method === PaymentMethod.BANK && (p.bankAccountId == null || p.bankAccountId < 1)) {
          throw new BadRequestException('Compte bancaire requis pour un paiement banque');
        }
      }

      const paymentTotal = createSaleDto.payments.reduce((acc, p) => acc + p.amount, 0);
      const tenderedRaw =
        createSaleDto.amountReceived != null ? Number(createSaleDto.amountReceived) : null;
      const hasTender = tenderedRaw != null && Number.isFinite(tenderedRaw);

      let amountReceived = hasTender ? this.round2(Math.max(0, tenderedRaw!)) : this.round2(paymentTotal);
      let changeDue = 0;
      let amountPaid = this.round2(paymentTotal);

      if (hasTender) {
        // Paiements = part appliquée à la vente (pas le tender brut).
        amountPaid = this.round2(Math.min(amountReceived, total));
        changeDue = this.round2(Math.max(0, amountReceived - total));
        if (amountPaid < 0.01 && total > 0.009) {
          throw new BadRequestException('Montant reçu insuffisant');
        }
      } else if (paymentTotal < total - 0.01) {
        throw new BadRequestException('Le montant payé est inférieur au total de la vente');
      }

      // IMPORTANT: Prisma tente actuellement d'insérer la colonne `Sale.clientName` alors que
      // la migration n'est pas forcément appliquée sur la DB. On contourne le create Prisma :
      // 1) insertion Sale via SQL brut (sans clientName)
      // 2) insertion SaleItem/Payment via Prisma (sans toucher au modèle Sale)
      // 3) update "best-effort" de clientName si la colonne existe
      const clientNameRaw =
        createSaleDto.clientName && createSaleDto.clientName.trim() ? createSaleDto.clientName.trim() : null;

      let cashier: string | null = null;
      if (userId) {
        const u = await tx.user.findUnique({
          where: { id: userId },
          select: { fullName: true, phone: true },
        });
        cashier = u?.fullName?.trim() || u?.phone?.trim() || `User#${userId}`;
      }
      const storeId = createSaleDto.storeId ?? null;
      const registerId = createSaleDto.registerId ?? null;

      const clientUuid = createSaleDto.clientUuid ?? null;
      // uuid : plus de DEFAULT SQL après drift Prisma (@default(uuid()) côté client seulement).
      // L’INSERT brut doit donc fournir uuid explicitement.
      const saleUuid = randomUUID();
      const insertedRows = await tx.$queryRaw<Array<{ id: number }>>`
        INSERT INTO "Sale"
          ("uuid", "total", "subtotal", "tax", "cashier", "userId", "storeId", "registerId", "clientUuid",
           "amountPaid", "amountReceived", "changeDue", "updatedAt")
        VALUES
          (${saleUuid}, ${total}, ${total}, 0, ${cashier}, ${userId ?? null}, ${storeId}, ${registerId}, ${clientUuid},
           ${amountPaid}, ${amountReceived}, ${changeDue}, NOW())
        RETURNING "id";
      `;
      const saleId = insertedRows?.[0]?.id;
      if (!saleId) throw new BadRequestException('Impossible de créer la vente.');

      // Numéro métier = id d’origine ; conservé tel quel lors du sync (≠ id local cible).
      await tx.$executeRaw`
        UPDATE "Sale" SET "txnNumber" = ${saleId} WHERE "id" = ${saleId} AND "txnNumber" IS NULL
      `;
      const txnNumber = saleId;

      await tx.saleItem.createMany({
        data: saleItemsData.map((it) => ({
          saleId,
          quantity: it.quantity as unknown as Prisma.Decimal,
          baseQuantity: it.baseQuantity as unknown as Prisma.Decimal,
          unitPrice: it.unitPrice as unknown as Prisma.Decimal,
          subtotal: it.subtotal as unknown as Prisma.Decimal,
          lineLabel: it.lineLabel ?? null,
          productId: (it.product as unknown as { connect: { id: number } }).connect.id,
          productSaleUnitId: (it.productSaleUnit as unknown as { connect: { id: number } }).connect.id,
          createdAt: new Date(),
        })),
      });

      // Stocker la part appliquée (pas le tender) pour que caisse / finance restent justes.
      let appliedPayments = hasTender
        ? createSaleDto.payments
            .map((p, idx) => (idx === 0 ? { ...p, amount: amountPaid } : { ...p, amount: 0 }))
            .filter((p) => p.amount > 0.009)
        : [...createSaleDto.payments];

      if (appliedPayments.length === 0 && amountPaid > 0.009) {
        appliedPayments = [
          {
            method: createSaleDto.payments[0]?.method ?? PaymentMethod.CASH,
            amount: amountPaid,
            reference: createSaleDto.payments[0]?.reference,
            bankAccountId: createSaleDto.payments[0]?.bankAccountId,
          },
        ];
      }

      // Valider / créditer les comptes banque (hors caisse) avant d’enregistrer les paiements.
      const bankPaymentRefs = new Map<number, string>();
      for (let i = 0; i < appliedPayments.length; i++) {
        const payment = appliedPayments[i];
        if (payment.method !== PaymentMethod.BANK || payment.amount <= 0.009) continue;
        const accountId = payment.bankAccountId;
        if (accountId == null) {
          throw new BadRequestException('Compte bancaire requis pour un paiement banque');
        }
        const account = await tx.bankAccount.findFirst({
          where: {
            id: accountId,
            deletedAt: null,
            isActive: true,
            bank: { deletedAt: null, isActive: true },
            ...(firstCompanyId != null ? { companyId: firstCompanyId } : {}),
          },
          include: { bank: { select: { id: true, name: true } } },
        });
        if (!account) {
          throw new BadRequestException('Compte bancaire introuvable ou inactif');
        }
        await tx.bankTransaction.create({
          data: {
            bankAccountId: account.id,
            type: BankTransactionType.DEPOSIT,
            amount: payment.amount,
            description: `Vente #${txnNumber} — ${account.bank.name} / ${account.name}`,
            reference: `saleTxn:${txnNumber}`,
            userId: userId ?? null,
          },
        });
        bankPaymentRefs.set(i, payment.reference?.trim() || `${account.bank.name} · ${account.name}`);
      }

      await tx.payment.createMany({
        data: appliedPayments.map((payment, i) => ({
          saleId,
          amount: payment.amount as unknown as Prisma.Decimal,
          method: payment.method,
          reference: bankPaymentRefs.get(i) ?? payment.reference ?? null,
          bankAccountId:
            payment.method === PaymentMethod.BANK ? (payment.bankAccountId ?? null) : null,
        })),
      });

      // Journal financier : INCOME = part réellement appliquée (hors CREDIT).
      // BANK y figure (revenu) mais n’entre PAS dans le cash de fermeture de caisse.
      const cashCollected = appliedPayments
        .filter((p) => p.method !== PaymentMethod.CREDIT)
        .reduce((acc, p) => acc + p.amount, 0);
      if (firstCompanyId != null && cashCollected > 0.009) {
        const categoryId = await this.findOrCreateVentesPosCategoryId(tx, firstCompanyId);
        const onlyBank =
          appliedPayments.length > 0 &&
          appliedPayments.every((p) => p.method === PaymentMethod.BANK);
        await tx.financeEntry.create({
          data: {
            type: FinanceType.INCOME,
            amount: cashCollected,
            description:
              cashCollected + 0.01 < total
                ? `Encaissement partiel vente #${txnNumber}`
                : onlyBank
                  ? `Encaissement banque vente #${txnNumber}`
                  : `Encaissement vente #${txnNumber}`,
            userId: userId ?? null,
            categoryId,
            saleId,
          },
        });
      }

      // Comptabilité en partie double (si exercice ouvert + plan initialisé).
      if (firstCompanyId != null) {
        const cashAmount = appliedPayments
          .filter((p) => p.method !== PaymentMethod.CREDIT && p.method !== PaymentMethod.BANK)
          .reduce((acc, p) => acc + p.amount, 0);
        const bankAmount = appliedPayments
          .filter((p) => p.method === PaymentMethod.BANK)
          .reduce((acc, p) => acc + p.amount, 0);
        const costRows = await tx.saleItem.findMany({
          where: { saleId },
          select: { baseQuantity: true, product: { select: { cost: true } } },
        });
        const cogs = costRows.reduce(
          (s, it) => s + Number(it.baseQuantity) * Number(it.product.cost ?? 0),
          0,
        );
        await this.accountingPosting.postPosSale(
          {
            companyId: firstCompanyId,
            saleId,
            entryDate: new Date(),
            total,
            cashAmount,
            bankAmount,
            cogs,
            createdById: userId,
            txnLabel: `#${txnNumber}`,
          },
          tx,
        );
      }

      if (clientNameRaw !== null) {
        try {
          await tx.$executeRaw`UPDATE "Sale" SET "clientName" = ${clientNameRaw} WHERE "id" = ${saleId}`;
        } catch {
          // Colonne non existante : on ignore pour ne pas bloquer l'encaissement.
        }
      }

      if (firstCompanyId != null) {
        const createdItems = await tx.saleItem.findMany({
          where: { saleId },
          select: { id: true, quantity: true },
          orderBy: { id: 'asc' },
        });
        if (createdItems.length) {
          await this.deliveriesService.createFromSaleTx(tx, {
            saleId,
            companyId: firstCompanyId,
            departmentId: firstDepartmentId,
            items: createdItems.map((it) => ({
              saleItemId: it.id,
              quantityOrdered: Number(it.quantity),
            })),
          });
        }
      }

      const sale = {
        id: saleId,
        txnNumber,
        total,
        amountPaid,
        amountReceived,
        changeDue,
        balanceDue: this.round2(Math.max(0, total - amountPaid)),
      };
      await this.auditService.log({
        userId,
        action: 'SALE_CREATED',
        entity: 'SALE',
        entityId: String(saleId),
        metadata: { total, amountReceived, changeDue, amountPaid },
      });
      return sale;
    });
  }

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  findAll() {
    return this.salesRepository.findAll();
  }

  findManyPaginated(opts: {
    companyId: number;
    skip?: number;
    take?: number;
    createdAtGte?: Date;
    createdAtLte?: Date;
    departmentId?: number;
  }) {
    const skip = Math.max(0, Math.floor(opts.skip ?? 0));
    const take = Math.min(100, Math.max(1, Math.floor(opts.take ?? 10)));
    return this.salesRepository.findManyPaginated({
      companyId: opts.companyId,
      skip,
      take,
      createdAtGte: opts.createdAtGte,
      createdAtLte: opts.createdAtLte,
      departmentId: opts.departmentId,
    });
  }

  async findOne(id: number) {
    const sale = await this.salesRepository.findOne(id);
    if (!sale) {
      throw new NotFoundException('Vente introuvable');
    }
    return sale;
  }

  /**
   * Écarts cash ouverts (héritage entre sessions de caisse) :
   * - changeDue > 0 : l’entreprise doit la monnaie au client
   * - amountPaid < total : le client doit un reste
   *
   * Important: on filtre directement les écarts ouverts (pas un échantillon
   * des N plus anciennes ventes, sinon les nouveaux écarts disparaissent
   * dès que l’historique dépasse cette fenêtre).
   *
   * Scope entreprise/département : lignes produit OU caisse (Register) —
   * les Remotes caissiers filtrent souvent par département ; sans le OR
   * Register, une vente syncée sans SaleItem disparaît du panneau.
   * On n’utilise pas Sale.clientName dans le SQL (colonne parfois absente
   * sur un nœud cloud non migré — ça faisait planter /sales/cash-gaps).
   */
  async listCashGaps(opts: { companyId: number; departmentId?: number; take?: number }) {
    const take = Math.min(100, Math.max(1, Math.floor(opts.take ?? 50)));
    // Register n’a PAS companyId : entreprise via Store (ou Department).
    const scopeClause =
      opts.departmentId != null
        ? Prisma.sql`AND (
            EXISTS (
              SELECT 1 FROM "SaleItem" si
              JOIN "Product" p ON p.id = si."productId"
              WHERE si."saleId" = s.id
                AND si."deletedAt" IS NULL
                AND p."companyId" = ${opts.companyId}
                AND p."departmentId" = ${opts.departmentId}
            )
            OR EXISTS (
              SELECT 1 FROM "Register" r
              JOIN "Store" st ON st.id = r."storeId"
              WHERE r.id = s."registerId"
                AND st."companyId" = ${opts.companyId}
                AND r."departmentId" = ${opts.departmentId}
            )
          )`
        : Prisma.sql`AND (
            EXISTS (
              SELECT 1 FROM "SaleItem" si
              JOIN "Product" p ON p.id = si."productId"
              WHERE si."saleId" = s.id
                AND si."deletedAt" IS NULL
                AND p."companyId" = ${opts.companyId}
            )
            OR EXISTS (
              SELECT 1 FROM "Register" r
              JOIN "Store" st ON st.id = r."storeId"
              WHERE r.id = s."registerId"
                AND st."companyId" = ${opts.companyId}
            )
          )`;

    type GapRow = {
      id: number;
      txnNumber: number | null;
      total: Prisma.Decimal | number;
      amountPaid: Prisma.Decimal | number;
      amountReceived: Prisma.Decimal | number;
      changeDue: Prisma.Decimal | number;
      cashier: string | null;
      createdAt: Date;
    };

    const changeRows = await this.prisma.$queryRaw<GapRow[]>`
      SELECT s.id, s."txnNumber" AS "txnNumber", s.total, s."amountPaid", s."amountReceived",
             s."changeDue", s.cashier, s."createdAt"
      FROM "Sale" s
      WHERE s."deletedAt" IS NULL
        AND s.status = 'COMPLETED'
        AND s."creditCustomerId" IS NULL
        AND s."changeDue" > 0.009
        ${scopeClause}
      ORDER BY s."createdAt" ASC
      LIMIT ${take}
    `;

    const balanceRows = await this.prisma.$queryRaw<GapRow[]>`
      SELECT s.id, s."txnNumber" AS "txnNumber", s.total, s."amountPaid", s."amountReceived",
             s."changeDue", s.cashier, s."createdAt"
      FROM "Sale" s
      WHERE s."deletedAt" IS NULL
        AND s.status = 'COMPLETED'
        AND s."creditCustomerId" IS NULL
        AND s."changeDue" <= 0.009
        AND s."amountPaid" < s.total - 0.009
        ${scopeClause}
      ORDER BY s."createdAt" ASC
      LIMIT ${take}
    `;

    const clientNames = await this.loadSaleClientNames([
      ...changeRows.map((s) => s.id),
      ...balanceRows.map((s) => s.id),
    ]);

    const changeOwed = changeRows.map((s) => ({
      id: s.id,
      txnNumber: s.txnNumber ?? s.id,
      clientName: clientNames.get(s.id) ?? null,
      cashier: s.cashier,
      createdAt: s.createdAt,
      total: Number(s.total),
      amountReceived: Number(s.amountReceived),
      amountPaid: Number(s.amountPaid),
      changeDue: Number(s.changeDue),
      balanceDue: 0,
      kind: 'CHANGE_OWED' as const,
    }));

    const balanceOwed = balanceRows.map((s) => {
      const total = Number(s.total);
      const paid = Number(s.amountPaid);
      return {
        id: s.id,
        txnNumber: s.txnNumber ?? s.id,
        clientName: clientNames.get(s.id) ?? null,
        cashier: s.cashier,
        createdAt: s.createdAt,
        total,
        amountReceived: Number(s.amountReceived),
        amountPaid: paid,
        changeDue: 0,
        balanceDue: this.round2(total - paid),
        kind: 'BALANCE_OWED' as const,
      };
    });

    return { changeOwed, balanceOwed };
  }

  /** Best-effort : `Sale.clientName` peut être absente sur un nœud non migré. */
  private async loadSaleClientNames(ids: number[]): Promise<Map<number, string | null>> {
    const map = new Map<number, string | null>();
    const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
    if (!unique.length) return map;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: number; clientName: string | null }>>`
        SELECT s.id, s."clientName" AS "clientName"
        FROM "Sale" s
        WHERE s.id IN (${Prisma.join(unique)})
      `;
      for (const r of rows) map.set(r.id, r.clientName);
    } catch {
      /* colonne absente — panneau cash-gaps reste utilisable */
    }
    return map;
  }

  /** Remet la monnaie due au client (sort les espèces de la caisse). */
  async settleChange(saleId: number, userId?: number) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, deletedAt: null, creditCustomerId: null },
    });
    if (!sale) throw new NotFoundException('Vente introuvable');
    if (sale.status !== 'COMPLETED') {
      throw new BadRequestException('Vente non complétée');
    }
    const due = this.round2(Number(sale.changeDue));
    if (due <= 0.009) {
      throw new BadRequestException('Aucune monnaie due sur cette fiche');
    }

    const updated = await this.prisma.sale.update({
      where: { id: saleId },
      data: {
        changeDue: 0,
        changeSettledAt: new Date(),
      },
      select: {
        id: true,
        total: true,
        amountPaid: true,
        amountReceived: true,
        changeDue: true,
        clientName: true,
      },
    });

    await this.auditService.log({
      userId,
      action: 'SALE_CHANGE_SETTLED',
      entity: 'SALE',
      entityId: String(saleId),
      metadata: { changeSettled: due },
    });

    return {
      id: updated.id,
      changeSettled: due,
      changeDue: 0,
      balanceDue: this.round2(Math.max(0, Number(updated.total) - Number(updated.amountPaid))),
    };
  }

  /** Encaisser un reste dû par le client sur une vente classique. */
  async collectBalance(saleId: number, amount: number, userId?: number) {
    const pay = this.round2(amount);
    if (pay <= 0) throw new BadRequestException('Montant invalide');

    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, deletedAt: null, creditCustomerId: null },
        include: {
          items: {
            where: { deletedAt: null },
            take: 1,
            include: { product: { select: { companyId: true } } },
          },
        },
      });
      if (!sale) throw new NotFoundException('Vente introuvable');
      if (sale.status !== 'COMPLETED') {
        throw new BadRequestException('Vente non complétée');
      }
      if (Number(sale.changeDue) > 0.009) {
        throw new BadRequestException('Réglez d’abord la monnaie due au client');
      }

      const total = this.round2(Number(sale.total));
      const paid = this.round2(Number(sale.amountPaid));
      const due = this.round2(Math.max(0, total - paid));
      if (due <= 0.009) {
        throw new BadRequestException('Aucun reste à encaisser');
      }
      if (pay > due + 0.01) {
        throw new BadRequestException(`Montant supérieur au reste (${due.toFixed(2)} HTG)`);
      }

      const apply = Math.min(pay, due);
      await tx.payment.create({
        data: {
          saleId,
          amount: apply,
          method: 'CASH',
          reference: 'Reste dû POS',
        },
      });

      const newPaid = this.round2(paid + apply);
      const settled = newPaid >= total - 0.009;
      await tx.sale.update({
        where: { id: saleId },
        data: {
          amountPaid: newPaid,
          amountReceived: { increment: apply },
          cashBalanceSettledAt: settled ? new Date() : sale.cashBalanceSettledAt,
        },
      });

      const companyId = sale.items[0]?.product?.companyId;
      if (companyId != null && apply > 0.009) {
        const categoryId = await this.findOrCreateVentesPosCategoryId(tx, companyId);
        // Une 2e écriture finance (saleId unique) : on n’attache pas saleId pour éviter le conflit.
        await tx.financeEntry.create({
          data: {
            type: FinanceType.INCOME,
            amount: apply,
            description: `Reste dû vente #${saleId}`,
            userId: userId ?? null,
            categoryId,
          },
        });
      }

      await this.auditService.log({
        userId,
        action: 'SALE_BALANCE_COLLECTED',
        entity: 'SALE',
        entityId: String(saleId),
        metadata: { amount: apply, balanceDue: this.round2(total - newPaid) },
      });

      return {
        id: saleId,
        amountCollected: apply,
        amountPaid: newPaid,
        balanceDue: this.round2(Math.max(0, total - newPaid)),
        changeDue: 0,
      };
    });
  }

  async cancelSale(id: number, userId?: number) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, deletedAt: null },
      include: { items: { include: { product: { select: { companyId: true } } } } },
    });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    if (sale.status !== 'COMPLETED') {
      throw new BadRequestException('Only completed sales can be cancelled');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.reverseDeliveredStockForSale(tx, id, userId, 'Annulation vente');
      await this.reverseBankDepositsForSale(tx, id);
      await tx.financeEntry.deleteMany({ where: { saleId: id } });
      const companyId = sale.items[0]?.product?.companyId;
      if (companyId != null) {
        await this.accountingPosting.voidBySource(companyId, 'SALE', String(id), tx);
        await this.accountingPosting.voidBySource(companyId, 'SALE_COGS', String(id), tx);
      }
      const updated = await tx.sale.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      await this.auditService.log({
        userId,
        action: 'SALE_CANCELLED',
        entity: 'SALE',
        entityId: String(id),
      });
      return updated;
    });
  }

  async refundSale(id: number, userId?: number) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, deletedAt: null },
      include: { items: { include: { product: { select: { companyId: true } } } } },
    });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    if (sale.status !== 'COMPLETED') {
      throw new BadRequestException('Only completed sales can be refunded');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.reverseDeliveredStockForSale(tx, id, userId, 'Remboursement vente');
      await this.reverseBankDepositsForSale(tx, id);
      await tx.financeEntry.deleteMany({ where: { saleId: id } });
      const companyId = sale.items[0]?.product?.companyId;
      if (companyId != null) {
        await this.accountingPosting.voidBySource(companyId, 'SALE', String(id), tx);
        await this.accountingPosting.voidBySource(companyId, 'SALE_COGS', String(id), tx);
      }
      const updated = await tx.sale.update({
        where: { id },
        data: { status: 'REFUNDED' },
      });
      await this.auditService.log({
        userId,
        action: 'SALE_REFUNDED',
        entity: 'SALE',
        entityId: String(id),
      });
      return updated;
    });
  }

  /**
   * Suppression admin (tombstone sync) : soft-delete Sale + lignes liées.
   * Ne plus hard-delete : la sync append-only recréait sinon la vente depuis l’autre nœud.
   */
  async deleteSalePermanently(saleId: number, adminUserId?: number, companyId?: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { product: true } } },
    });
    if (!sale) {
      throw new NotFoundException('Vente introuvable');
    }
    if (sale.deletedAt) {
      return { ok: true, id: saleId, alreadyDeleted: true };
    }
    if (companyId != null && companyId > 0) {
      const mismatch = sale.items.some((i) => i.product.companyId !== companyId);
      if (mismatch) {
        throw new BadRequestException("Cette vente n'appartient pas à l'entreprise sélectionnée.");
      }
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      if (sale.status === 'COMPLETED' && sale.items.length > 0) {
        await this.reverseDeliveredStockForSale(
          tx,
          saleId,
          adminUserId,
          'Suppression vente (admin)',
        );
      }

      await this.reverseBankDepositsForSale(tx, saleId);
      await tx.financeEntry.updateMany({
        where: { saleId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.payment.updateMany({
        where: { saleId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.saleItem.updateMany({
        where: { saleId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.delivery.updateMany({
        where: { saleId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.sale.update({
        where: { id: saleId },
        data: { deletedAt: now },
      });

      await this.auditService.log({
        userId: adminUserId,
        action: 'SALE_DELETED_PERMANENTLY',
        entity: 'SALE',
        entityId: String(saleId),
        metadata: { previousStatus: sale.status, soft: true },
      });
      return { ok: true, id: saleId };
    });
  }

  private async findOrCreateVentesPosCategoryId(tx: Prisma.TransactionClient, companyId: number) {
    const name = 'Ventes POS';
    const existing = await tx.expenseCategory.findFirst({
      where: { companyId, name },
    });
    if (existing) return existing.id;
    const created = await tx.expenseCategory.create({
      data: { companyId, name },
    });
    return created.id;
  }

  /** Annule les dépôts banque liés à une vente POS (`saleTxn:{txnNumber}` / ancien `sale:{id}`). */
  private async reverseBankDepositsForSale(tx: Prisma.TransactionClient, saleId: number) {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: { id: true, txnNumber: true },
    });
    const refs = [`sale:${saleId}`];
    if (sale?.txnNumber != null) refs.push(`saleTxn:${sale.txnNumber}`);
    await tx.bankTransaction.updateMany({
      where: {
        deletedAt: null,
        reference: { in: refs },
        type: BankTransactionType.DEPOSIT,
      },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Ré-entrée stock uniquement pour la part déjà livrée (la sortie se fait à la livraison).
   */
  private async reverseDeliveredStockForSale(
    tx: Prisma.TransactionClient,
    saleId: number,
    userId: number | undefined,
    reasonPrefix: string,
  ) {
    const delivery = await tx.delivery.findUnique({
      where: { saleId },
      include: {
        items: {
          include: {
            saleItem: {
              select: {
                productId: true,
                quantity: true,
                baseQuantity: true,
                product: { select: { id: true, name: true, trackStock: true, isService: true } },
              },
            },
          },
        },
      },
    });
    if (!delivery) return;

    for (const di of delivery.items) {
      const deliveredQty = Number(di.quantityDelivered);
      if (deliveredQty <= 0.0001) continue;
      const saleQty = Number(di.saleItem.quantity);
      const baseFull = Number(di.saleItem.baseQuantity);
      if (saleQty <= 0) continue;
      const baseQty = (deliveredQty / saleQty) * baseFull;
      if (baseQty <= 0.0001) continue;

      const product = di.saleItem.product;
      if (product.isService) {
        const recipe = await tx.productRecipe.findUnique({
          where: { parentProductId: product.id },
          include: { components: true },
        });
        if (recipe?.components.length) {
          for (const c of recipe.components) {
            const qty = Number(c.quantityPerParentBaseUnit) * baseQty;
            await tx.product.update({
              where: { id: c.componentProductId },
              data: { stock: { increment: qty } },
            });
            await tx.stockMovement.create({
              data: {
                productId: c.componentProductId,
                quantity: qty,
                type: MovementType.IN,
                reason: `${reasonPrefix} #${saleId} (recette ${product.name})`,
                createdById: userId,
              },
            });
          }
        }
      } else if (product.trackStock) {
        await tx.product.update({
          where: { id: product.id },
          data: { stock: { increment: baseQty } },
        });
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            quantity: baseQty,
            type: MovementType.IN,
            reason: `${reasonPrefix} #${saleId}`,
            createdById: userId,
          },
        });
      }
    }
  }

  /** PDF côté serveur (pdfkit), même principe que l’export inventaires. */
  async buildSalePdf(id: number): Promise<Buffer> {
    const sale = await this.salesRepository.findOne(id);
    if (!sale) {
      throw new NotFoundException('Vente introuvable');
    }

    const firstProduct = sale.items?.[0]?.product as
      | { companyId?: number; company?: { name?: string; logoUrl?: string | null } }
      | undefined;
    let companyName: string | null = firstProduct?.company?.name ?? null;
    let logoUrl: string | null = firstProduct?.company?.logoUrl ?? null;
    if ((!companyName || !logoUrl) && firstProduct?.companyId != null) {
      const co = await this.prisma.company.findUnique({
        where: { id: firstProduct.companyId },
        select: { name: true, logoUrl: true },
      });
      companyName = co?.name ?? companyName;
      logoUrl = co?.logoUrl ?? logoUrl;
    }

    const {
      collectPdfBuffer,
      createPdfDoc,
      drawKeyValueBlock,
      drawReportHeader,
      drawSectionTitle,
      drawTableHeader,
      drawTableRow,
      generatedMetaLine,
    } = await import('../../common/pdf/pdf-document');
    const { formatDateTimeFr, formatMoneyHtg, formatQty } = await import(
      '../../common/pdf/pdf-format'
    );

    const statusLabel =
      sale.status === 'COMPLETED'
        ? 'Complétée'
        : sale.status === 'CANCELLED'
          ? 'Annulée'
          : sale.status === 'REFUNDED'
            ? 'Remboursée'
            : sale.status;

    const paymentLabel = (method: string) => {
      switch (method) {
        case 'CASH':
          return 'Espèces';
        case 'CARD':
          return 'Carte';
        case 'MOBILE_MONEY':
          return 'Mobile money';
        case 'SPLIT':
          return 'Mixte';
        case 'BANK':
          return 'Banque';
        case 'CREDIT':
          return 'À crédit';
        default:
          return method;
      }
    };

    const doc = createPdfDoc();
    await drawReportHeader(doc, {
      title: `Ticket de vente #${sale.txnNumber ?? sale.id}`,
      brand: { companyName, logoUrl },
      metaLines: [generatedMetaLine()],
    });

    const cashier =
      sale.user?.fullName?.trim() || sale.cashier || sale.user?.phone || '—';
    drawKeyValueBlock(doc, [
      { label: 'Date', value: formatDateTimeFr(sale.createdAt) },
      { label: 'Statut', value: statusLabel },
      { label: 'Client', value: sale.clientName?.trim() || '—' },
      { label: 'Caissier', value: cashier },
    ]);

    doc.moveDown(0.35);
    drawSectionTitle(doc, 'Articles');

    const cols = [
      { key: 'label', label: 'Article', width: 250 },
      { key: 'qty', label: 'Qté', width: 60, align: 'right' as const },
      { key: 'unit', label: 'P.U.', width: 90, align: 'right' as const },
      { key: 'sub', label: 'Sous-total', width: 110, align: 'right' as const },
    ];
    drawTableHeader(doc, cols);
    (sale.items ?? []).forEach((line, i) => {
      drawTableRow(
        doc,
        cols,
        {
          label: line.lineLabel ?? line.product?.name ?? 'Article',
          qty: formatQty(line.quantity),
          unit: formatMoneyHtg(line.unitPrice),
          sub: formatMoneyHtg(line.subtotal),
        },
        { alt: i % 2 === 1 },
      );
    });

    doc.moveDown(0.45);
    drawKeyValueBlock(doc, [
      { label: 'Total', value: formatMoneyHtg(sale.total), emphasize: true },
    ]);

    if (sale.payments?.length) {
      doc.moveDown(0.35);
      drawSectionTitle(doc, 'Paiements');
      const payCols = [
        { key: 'method', label: 'Mode', width: 300 },
        { key: 'amount', label: 'Montant', width: 210, align: 'right' as const },
      ];
      drawTableHeader(doc, payCols);
      sale.payments.forEach((p, i) => {
        drawTableRow(
          doc,
          payCols,
          {
            method: paymentLabel(String(p.method)),
            amount: formatMoneyHtg(p.amount),
          },
          { alt: i % 2 === 1 },
        );
      });
    }

    return collectPdfBuffer(doc);
  }
}
