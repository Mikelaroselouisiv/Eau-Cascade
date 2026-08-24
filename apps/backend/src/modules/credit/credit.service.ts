import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankTransactionType,
  FinanceType,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { resolveFamilyUnitPrice, resolveVolumeUnitPrice } from '../../common/utils/volume-unit-price';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AuditService } from '../audit/audit.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  CreateCreditCustomerDto,
  CreateCreditSaleDto,
  RecordCreditPaymentDto,
  UpdateCreditCustomerDto,
} from './dto/credit.dto';

export type CreditStatus = 'CLEAR' | 'PARTIAL' | 'OVERDUE' | 'AT_LIMIT' | 'BLOCKED';

@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
    private readonly deliveriesService: DeliveriesService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  async listCustomers(companyId: number, opts?: { q?: string; includeInactive?: boolean }) {
    const q = opts?.q?.trim();
    const rows = await this.prisma.creditCustomer.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(opts?.includeInactive ? {} : { isActive: true }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        department: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    const balances = await this.balancesByCustomerIds(rows.map((r) => r.id));
    return rows.map((r) => {
      const bal = balances.get(r.id) ?? { balance: 0, salesCount: 0, oldestUnpaidAt: null as string | null };
      return {
        ...r,
        creditLimit: Number(r.creditLimit),
        balance: bal.balance,
        openSalesCount: bal.salesCount,
        oldestUnpaidAt: bal.oldestUnpaidAt,
        status: this.computeStatus(Number(r.creditLimit), bal.balance, bal.oldestUnpaidAt, r.isActive),
      };
    });
  }

  async getCustomer(id: number) {
    const customer = await this.prisma.creditCustomer.findFirst({
      where: { id, deletedAt: null },
      include: {
        department: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!customer) throw new NotFoundException('Client crédit introuvable');

    const sales = await this.prisma.sale.findMany({
      where: { creditCustomerId: id, deletedAt: null, status: 'COMPLETED' },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            productSaleUnit: { include: { packagingUnit: true } },
          },
        },
        payments: true,
        delivery: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const repayments = await this.prisma.creditPayment.findMany({
      where: { creditCustomerId: id, deletedAt: null },
      include: { user: { select: USER_ATTRIBUTION_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const saleRows = sales.map((s) => {
      const total = Number(s.total);
      const paid = Number(s.amountPaid);
      const due = this.round2(Math.max(0, total - paid));
      return {
        ...s,
        total,
        amountPaid: paid,
        balanceDue: due,
        items: s.items.map((it) => ({
          ...it,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          subtotal: Number(it.subtotal),
        })),
      };
    });

    const balance = this.round2(saleRows.reduce((a, s) => a + s.balanceDue, 0));
    const oldest = saleRows.find((s) => s.balanceDue > 0.009)?.createdAt ?? null;

    return {
      ...customer,
      creditLimit: Number(customer.creditLimit),
      balance,
      availableCredit: Math.max(0, Number(customer.creditLimit) - balance),
      status: this.computeStatus(
        Number(customer.creditLimit),
        balance,
        oldest ? new Date(oldest).toISOString() : null,
        customer.isActive,
      ),
      sales: saleRows,
      repayments: repayments.map((p) => ({
        ...p,
        amount: Number(p.amount),
      })),
      timeline: this.buildTimeline(saleRows, repayments),
    };
  }

  async createCustomer(dto: CreateCreditCustomerDto, userId?: number) {
    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable');
    if (dto.departmentId) {
      const d = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, companyId: dto.companyId, deletedAt: null },
      });
      if (!d) throw new BadRequestException('Département invalide pour cette entreprise');
    }

    const row = await this.prisma.creditCustomer.create({
      data: {
        companyId: dto.companyId,
        departmentId: dto.departmentId ?? null,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        address: dto.address?.trim() || null,
        note: dto.note?.trim() || null,
        creditLimit: dto.creditLimit ?? 0,
      },
    });
    await this.auditService.log({
      userId,
      action: 'CREDIT_CUSTOMER_CREATED',
      entity: 'CreditCustomer',
      entityId: String(row.id),
      metadata: { name: row.name, companyId: row.companyId },
    });
    return row;
  }

  async updateCustomer(id: number, dto: UpdateCreditCustomerDto, userId?: number) {
    const existing = await this.prisma.creditCustomer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Client crédit introuvable');

    const updated = await this.prisma.creditCustomer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        ...(dto.creditLimit !== undefined ? { creditLimit: dto.creditLimit } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId } : {}),
      },
    });
    await this.auditService.log({
      userId,
      action: 'CREDIT_CUSTOMER_UPDATED',
      entity: 'CreditCustomer',
      entityId: String(id),
    });
    return updated;
  }

  /**
   * Vente à crédit autonome : crée la vente + fiche livraison PENDING (comme le POS),
   * n’écrit PAS l’encaissement total en finance (seulement un acompte éventuel).
   * La sortie de stock se fait à la livraison.
   */
  async createCreditSale(dto: CreateCreditSaleDto, userId?: number) {
    const customer = await this.prisma.creditCustomer.findFirst({
      where: { id: dto.creditCustomerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Client crédit introuvable');
    if (!customer.isActive) throw new BadRequestException('Client crédit inactif');

    const balMap = await this.balancesByCustomerIds([customer.id]);
    const currentBalance = balMap.get(customer.id)?.balance ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const saleItemsData: Array<{
        quantity: number;
        baseQuantity: number;
        unitPrice: number;
        subtotal: number;
        lineLabel: string;
        productId: number;
        productSaleUnitId: number;
      }> = [];
      let total = 0;
      let firstDepartmentId: number | null = customer.departmentId;

      const loaded: Array<{
        item: (typeof dto.items)[number];
        psu: {
          id: number;
          salePrice: { toString(): string } | number;
          labelOverride: string | null;
          unitsPerPackage: { toString(): string } | number;
          product: {
            id: number;
            name: string;
            companyId: number;
            departmentId: number | null;
            isService: boolean;
            trackStock: boolean;
            productFamilyId: number | null;
            productFamily: {
              tiers: Array<{ minQuantity: unknown; unitPrice: unknown }>;
            } | null;
          };
          packagingUnit: { label: string };
          volumePrices: Array<{ minQuantity: unknown; unitPrice: unknown }>;
        };
        baseQuantity: number;
      }> = [];

      for (const item of dto.items) {
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
        if (!psu) throw new NotFoundException(`Unité de vente ${item.productSaleUnitId} introuvable`);
        const product = psu.product;
        if (product.companyId !== customer.companyId) {
          throw new BadRequestException(`Produit « ${product.name} » hors entreprise du client`);
        }
        if (firstDepartmentId == null && product.departmentId != null) {
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
            await this.inventoryService.ensureStockAvailabilityTx(
              tx,
              c.componentProductId,
              Number(c.quantityPerParentBaseUnit) * baseQuantity,
            );
          }
        } else if (product.trackStock && !product.isService) {
          await this.inventoryService.ensureStockAvailabilityTx(tx, product.id, baseQuantity);
        }

        loaded.push({ item, psu, baseQuantity });
      }

      const familyQty = new Map<number, number>();
      for (const line of loaded) {
        const fid = line.psu.product.productFamilyId;
        if (fid == null) continue;
        familyQty.set(fid, (familyQty.get(fid) ?? 0) + Number(line.item.quantity));
      }

      for (const line of loaded) {
        const { item, psu, baseQuantity } = line;
        const product = psu.product;
        const tierRows = psu.volumePrices.map((v) => ({
          minQuantity: Number(v.minQuantity),
          unitPrice: Number(v.unitPrice),
        }));
        const familyTiers =
          product.productFamily?.tiers.map((t) => ({
            minQuantity: Number(t.minQuantity),
            unitPrice: Number(t.unitPrice),
          })) ?? [];
        const familyPrice =
          product.productFamilyId != null
            ? resolveFamilyUnitPrice(familyTiers, familyQty.get(product.productFamilyId) ?? 0)
            : null;
        const unitPrice =
          familyPrice != null
            ? familyPrice
            : resolveVolumeUnitPrice(Number(psu.salePrice), tierRows, item.quantity);
        const subtotal = unitPrice * item.quantity;
        total += subtotal;
        const lineLabel = psu.labelOverride
          ? `${product.name} (${psu.labelOverride})`
          : `${product.name} (${psu.packagingUnit.label})`;

        saleItemsData.push({
          quantity: item.quantity,
          baseQuantity,
          unitPrice,
          subtotal,
          lineLabel,
          productId: product.id,
          productSaleUnitId: psu.id,
        });
      }

      total = this.round2(total);
      const down = this.round2(Math.max(0, dto.downPayment ?? 0));
      if (down > total + 0.01) {
        throw new BadRequestException('Acompte supérieur au total');
      }

      const newBalance = this.round2(currentBalance + (total - down));
      const limit = Number(customer.creditLimit);
      if (limit > 0 && newBalance > limit + 0.01) {
        throw new BadRequestException(
          `Plafond de crédit dépassé (solde prévu ${newBalance.toFixed(2)} HTG / limite ${limit.toFixed(2)} HTG)`,
        );
      }

      let cashier: string | null = null;
      if (userId) {
        const u = await tx.user.findUnique({
          where: { id: userId },
          select: { fullName: true, phone: true },
        });
        cashier = u?.fullName?.trim() || u?.phone?.trim() || `User#${userId}`;
      }

      const sale = await tx.sale.create({
        data: {
          total,
          subtotal: total,
          tax: 0,
          status: 'COMPLETED',
          cashier,
          clientName: customer.name,
          creditCustomerId: customer.id,
          amountPaid: down,
          userId: userId ?? null,
          items: {
            create: saleItemsData.map((it) => ({
              quantity: it.quantity,
              baseQuantity: it.baseQuantity,
              unitPrice: it.unitPrice,
              subtotal: it.subtotal,
              lineLabel: it.lineLabel,
              productId: it.productId,
              productSaleUnitId: it.productSaleUnitId,
            })),
          },
          // Un seul paiement CREDIT (total) : pas de Payment CASH d’acompte,
          // sinon la caisse classique le compterait comme encaissé POS.
          // L’acompte réel passe par CreditPayment + FinanceEntry ci-dessous.
          payments: {
            create: [
              {
                amount: total,
                method: PaymentMethod.CREDIT,
                reference: dto.note?.trim() || 'Vente à crédit',
              },
            ],
          },
        },
        include: { items: true },
      });

      // Numéro métier = id d’origine (aligné impression / dashboard / sync).
      const txnNumber = sale.id;
      await tx.sale.update({
        where: { id: sale.id },
        data: { txnNumber },
      });

      // Fiche livraison PENDING — stock sort à la livraison (même flux que le POS).
      const delivery = await this.deliveriesService.createFromSaleTx(tx, {
        saleId: sale.id,
        companyId: customer.companyId,
        departmentId: firstDepartmentId,
        items: sale.items.map((it) => ({
          saleItemId: it.id,
          quantityOrdered: Number(it.quantity),
        })),
      });

      const downMethod =
        dto.downPaymentMethod && dto.downPaymentMethod !== PaymentMethod.CREDIT
          ? dto.downPaymentMethod
          : PaymentMethod.CASH;

      // Acompte → journal entreprise « Encaissements crédit » (hors caisse POS).
      if (down > 0.009) {
        const categoryId = await this.findOrCreateCreditCashCategoryId(tx, customer.companyId);
        const fe = await tx.financeEntry.create({
          data: {
            type: FinanceType.INCOME,
            amount: down,
            description: `Acompte crédit — ${customer.name} — vente #${sale.id}`,
            userId: userId ?? null,
            categoryId,
          },
        });
        await tx.creditPayment.create({
          data: {
            creditCustomerId: customer.id,
            saleId: sale.id,
            amount: down,
            method: downMethod,
            note: 'Acompte à l’achat',
            userId: userId ?? null,
            financeEntryId: fe.id,
          },
        });
      }

      const costRows = await tx.saleItem.findMany({
        where: { saleId: sale.id },
        select: { baseQuantity: true, product: { select: { cost: true } } },
      });
      const cogs = costRows.reduce(
        (s, it) => s + Number(it.baseQuantity) * Number(it.product.cost ?? 0),
        0,
      );

      await this.accountingPosting.postCreditSale(
        {
          companyId: customer.companyId,
          saleId: sale.id,
          entryDate: new Date(),
          total,
          downPayment: down,
          downMethod,
          cogs,
          customerName: customer.name,
          createdById: userId,
        },
        tx,
      );

      await this.auditService.log({
        userId,
        action: 'CREDIT_SALE_CREATED',
        entity: 'Sale',
        entityId: String(sale.id),
        metadata: {
          creditCustomerId: customer.id,
          total,
          downPayment: down,
          deliveryId: delivery.id,
        },
      });

      return {
        saleId: sale.id,
        txnNumber,
        total,
        amountPaid: down,
        balanceDue: this.round2(total - down),
        deliveryId: delivery.id,
      };
    });
  }

  async recordPayment(dto: RecordCreditPaymentDto, userId?: number) {
    const amount = this.round2(dto.amount);
    if (amount <= 0) throw new BadRequestException('Montant invalide');

    const customer = await this.prisma.creditCustomer.findFirst({
      where: { id: dto.creditCustomerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Client crédit introuvable');

    const method =
      dto.method && dto.method !== PaymentMethod.CREDIT ? dto.method : PaymentMethod.CASH;

    if (method === PaymentMethod.BANK && (dto.bankAccountId == null || dto.bankAccountId < 1)) {
      throw new BadRequestException('Compte bancaire requis pour un paiement banque');
    }

    return this.prisma.$transaction(async (tx) => {
      let remaining = amount;
      const allocations: Array<{ saleId: number; amount: number }> = [];

      if (dto.saleId) {
        const sale = await tx.sale.findFirst({
          where: {
            id: dto.saleId,
            creditCustomerId: customer.id,
            deletedAt: null,
            status: 'COMPLETED',
          },
        });
        if (!sale) throw new NotFoundException('Vente crédit introuvable');
        const due = this.round2(Number(sale.total) - Number(sale.amountPaid));
        if (due <= 0.009) throw new BadRequestException('Cette vente est déjà soldée');
        const apply = Math.min(remaining, due);
        await tx.sale.update({
          where: { id: sale.id },
          data: { amountPaid: { increment: apply } },
        });
        allocations.push({ saleId: sale.id, amount: apply });
        remaining = this.round2(remaining - apply);
      } else {
        const openSales = await tx.sale.findMany({
          where: {
            creditCustomerId: customer.id,
            deletedAt: null,
            status: 'COMPLETED',
          },
          orderBy: { createdAt: 'asc' },
        });
        for (const sale of openSales) {
          if (remaining <= 0.009) break;
          const due = this.round2(Number(sale.total) - Number(sale.amountPaid));
          if (due <= 0.009) continue;
          const apply = Math.min(remaining, due);
          await tx.sale.update({
            where: { id: sale.id },
            data: { amountPaid: { increment: apply } },
          });
          allocations.push({ saleId: sale.id, amount: apply });
          remaining = this.round2(remaining - apply);
        }
      }

      const applied = this.round2(amount - remaining);
      if (applied <= 0.009) {
        throw new BadRequestException('Aucune créance ouverte à solder pour ce montant');
      }

      let bankAccount: {
        id: number;
        name: string;
        bank: { id: number; name: string };
      } | null = null;
      if (method === PaymentMethod.BANK) {
        bankAccount = await tx.bankAccount.findFirst({
          where: {
            id: dto.bankAccountId!,
            companyId: customer.companyId,
            deletedAt: null,
            isActive: true,
            bank: { deletedAt: null, isActive: true },
          },
          include: { bank: { select: { id: true, name: true } } },
        });
        if (!bankAccount) {
          throw new BadRequestException('Compte bancaire introuvable ou inactif');
        }
      }

      const categoryId = await this.findOrCreateCreditCashCategoryId(tx, customer.companyId);
      const saleSuffix =
        allocations.length === 1 ? ` — vente #${allocations[0].saleId}` : '';
      const fe = await tx.financeEntry.create({
        data: {
          type: FinanceType.INCOME,
          amount: applied,
          description:
            method === PaymentMethod.BANK
              ? `Remboursement crédit banque — ${customer.name}${saleSuffix}`
              : `Remboursement crédit — ${customer.name}${saleSuffix}`,
          userId: userId ?? null,
          categoryId,
        },
      });

      const bankReference = bankAccount
        ? dto.reference?.trim() || `${bankAccount.bank.name} · ${bankAccount.name}`
        : dto.reference?.trim() || null;

      const payment = await tx.creditPayment.create({
        data: {
          creditCustomerId: customer.id,
          saleId: allocations.length === 1 ? allocations[0].saleId : dto.saleId ?? null,
          amount: applied,
          method,
          reference: bankReference,
          bankAccountId: bankAccount?.id ?? null,
          note: dto.note?.trim() || null,
          userId: userId ?? null,
          financeEntryId: fe.id,
        },
      });

      // Dépôt banque après CreditPayment pour une référence stable (sync / réconciliation).
      if (bankAccount) {
        const saleRef =
          allocations.length === 1 ? `vente #${allocations[0].saleId}` : 'multi-ventes';
        await tx.bankTransaction.create({
          data: {
            bankAccountId: bankAccount.id,
            type: BankTransactionType.DEPOSIT,
            amount: applied,
            description: `Remboursement crédit — ${customer.name} — ${saleRef} — ${bankAccount.bank.name} / ${bankAccount.name}`,
            reference: `creditPayment:${payment.uuid}`,
            userId: userId ?? null,
          },
        });
      }

      await this.accountingPosting.postCreditPayment(
        {
          companyId: customer.companyId,
          paymentId: payment.id,
          entryDate: new Date(),
          amount: applied,
          method,
          customerName: customer.name,
          createdById: userId,
        },
        tx,
      );

      await this.auditService.log({
        userId,
        action: 'CREDIT_PAYMENT_RECORDED',
        entity: 'CreditPayment',
        entityId: String(payment.id),
        metadata: {
          applied,
          allocations,
          remainderUnused: remaining,
          method,
          bankAccountId: bankAccount?.id ?? null,
        },
      });

      return {
        payment,
        applied,
        unused: remaining,
        allocations,
        financeEntryId: fe.id,
      };
    });
  }

  async summary(companyId: number) {
    const customers = await this.listCustomers(companyId, { includeInactive: true });
    const active = customers.filter((c) => c.isActive);
    const withDebt = active.filter((c) => c.balance > 0.009);
    const clear = active.filter((c) => c.balance <= 0.009);
    const overdue = withDebt.filter((c) => c.status === 'OVERDUE' || c.status === 'AT_LIMIT');
    const totalReceivable = this.round2(withDebt.reduce((a, c) => a + c.balance, 0));
    return {
      customersTotal: active.length,
      withDebt: withDebt.length,
      clear: clear.length,
      overdue: overdue.length,
      totalReceivable,
      topDebtors: [...withDebt].sort((a, b) => b.balance - a.balance).slice(0, 8),
    };
  }

  private computeStatus(
    creditLimit: number,
    balance: number,
    oldestUnpaidAt: string | null,
    isActive: boolean,
  ): CreditStatus {
    if (!isActive) return 'BLOCKED';
    if (balance <= 0.009) return 'CLEAR';
    if (creditLimit > 0 && balance >= creditLimit - 0.01) return 'AT_LIMIT';
    if (oldestUnpaidAt) {
      const ageDays =
        (Date.now() - new Date(oldestUnpaidAt).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays >= 30) return 'OVERDUE';
    }
    return 'PARTIAL';
  }

  private async balancesByCustomerIds(ids: number[]) {
    const map = new Map<
      number,
      { balance: number; salesCount: number; oldestUnpaidAt: string | null }
    >();
    if (!ids.length) return map;

    const sales = await this.prisma.sale.findMany({
      where: {
        creditCustomerId: { in: ids },
        deletedAt: null,
        status: 'COMPLETED',
      },
      select: {
        creditCustomerId: true,
        total: true,
        amountPaid: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const id of ids) {
      map.set(id, { balance: 0, salesCount: 0, oldestUnpaidAt: null });
    }
    for (const s of sales) {
      if (s.creditCustomerId == null) continue;
      const due = this.round2(Number(s.total) - Number(s.amountPaid));
      if (due <= 0.009) continue;
      const cur = map.get(s.creditCustomerId)!;
      cur.balance = this.round2(cur.balance + due);
      cur.salesCount += 1;
      if (!cur.oldestUnpaidAt) cur.oldestUnpaidAt = s.createdAt.toISOString();
    }
    return map;
  }

  private buildTimeline(
    sales: Array<{
      id: number;
      createdAt: Date;
      total: number;
      amountPaid: number;
      balanceDue: number;
    }>,
    repayments: Array<{
      id: number;
      createdAt: Date;
      amount: Prisma.Decimal | number;
      saleId: number | null;
      note: string | null;
    }>,
  ) {
    const events: Array<{
      at: string;
      kind: 'SALE' | 'PAYMENT';
      label: string;
      amount: number;
      meta?: Record<string, unknown>;
    }> = [];

    for (const s of sales) {
      events.push({
        at: new Date(s.createdAt).toISOString(),
        kind: 'SALE',
        label: `Achat à crédit #${s.id}`,
        amount: s.total,
        meta: { saleId: s.id, balanceDue: s.balanceDue, paid: s.amountPaid },
      });
    }
    for (const p of repayments) {
      events.push({
        at: new Date(p.createdAt).toISOString(),
        kind: 'PAYMENT',
        label: p.note?.trim() || `Remboursement #${p.id}`,
        amount: Number(p.amount),
        meta: { paymentId: p.id, saleId: p.saleId },
      });
    }
    return events.sort((a, b) => b.at.localeCompare(a.at));
  }

  private async findOrCreateCreditCashCategoryId(
    tx: Prisma.TransactionClient,
    companyId: number,
  ) {
    const name = 'Encaissements crédit';
    const existing = await tx.expenseCategory.findFirst({
      where: { companyId, name },
    });
    if (existing) return existing.id;
    const created = await tx.expenseCategory.create({
      data: { companyId, name },
    });
    return created.id;
  }
}
