import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { ymdToBusinessNoon } from '../../common/utils/business-timezone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingPostingService } from './accounting-posting.service';
import { AccountingService } from './accounting.service';
import {
  CreateFixedAssetDto,
  CreateSupplierPaymentDto,
  RunDepreciationDto,
} from './dto/accounting.dto';

@Injectable()
export class AccountingAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: AccountingPostingService,
    private readonly accounting: AccountingService,
    private readonly audit: AuditService,
  ) {}

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private dateOnly(ymd: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) throw new BadRequestException('Date invalide (YYYY-MM-DD)');
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  private periodFromYmd(ymd: string): string {
    return ymd.trim().slice(0, 7);
  }

  private monthEndDate(period: string): Date {
    const m = /^(\d{4})-(\d{2})$/.exec(period);
    if (!m) throw new BadRequestException('Période invalide (YYYY-MM)');
    const y = Number(m[1]);
    const mo = Number(m[2]);
    // dernier jour du mois en UTC
    return new Date(Date.UTC(y, mo, 0));
  }

  /** Solde créditeur du compte fournisseurs (401) + liste des paiements. */
  async suppliersOverview(companyId: number) {
    await this.accounting.ensureChartOfAccounts(companyId);
    const account = await this.prisma.account.findFirst({
      where: { companyId, systemKey: 'SUPPLIERS', deletedAt: null },
    });
    let balance = 0;
    if (account) {
      const agg = await this.prisma.journalLine.aggregate({
        where: {
          accountId: account.id,
          journalEntry: {
            companyId,
            status: 'POSTED',
            deletedAt: null,
          },
        },
        _sum: { debit: true, credit: true },
      });
      balance = this.round2(Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0));
    }

    const payments = await this.prisma.supplierPayment.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { paidAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        bankAccount: {
          select: { id: true, name: true, bank: { select: { name: true } } },
        },
      },
    });

    // Fournisseurs distincts depuis les achats
    const names = await this.prisma.purchaseOrder.findMany({
      where: { companyId, deletedAt: null, supplierName: { not: null } },
      select: { supplierName: true },
      distinct: ['supplierName'],
      take: 200,
    });

    return {
      suppliersPayable: Math.max(0, balance),
      supplierNames: names
        .map((n) => n.supplierName?.trim())
        .filter((n): n is string => Boolean(n)),
      payments,
    };
  }

  async createSupplierPayment(dto: CreateSupplierPaymentDto, userId?: number) {
    await this.accounting.ensureChartOfAccounts(dto.companyId);
    const amount = this.round2(dto.amount);
    if (amount <= 0) throw new BadRequestException('Montant invalide');

    const method =
      dto.method === 'BANK' ? PaymentMethod.BANK : PaymentMethod.CASH;
    if (method === PaymentMethod.BANK && (dto.bankAccountId == null || dto.bankAccountId < 1)) {
      throw new BadRequestException('Compte bancaire requis pour un paiement banque');
    }

    let paidAt = new Date();
    if (dto.paidOn?.trim()) {
      try {
        paidAt = ymdToBusinessNoon(dto.paidOn.trim());
      } catch {
        throw new BadRequestException('paidOn invalide');
      }
    }

    if (method === PaymentMethod.BANK) {
      const acc = await this.prisma.bankAccount.findFirst({
        where: {
          id: dto.bankAccountId!,
          companyId: dto.companyId,
          deletedAt: null,
          isActive: true,
        },
      });
      if (!acc) throw new BadRequestException('Compte bancaire introuvable');
    }

    const row = await this.prisma.supplierPayment.create({
      data: {
        companyId: dto.companyId,
        supplierName: dto.supplierName.trim(),
        amount,
        method,
        bankAccountId: method === PaymentMethod.BANK ? dto.bankAccountId! : null,
        goodsReceiptId: dto.goodsReceiptId ?? null,
        note: dto.note?.trim() || null,
        paidAt,
        userId: userId ?? null,
      },
    });

    await this.posting.postSupplierPayment({
      companyId: dto.companyId,
      paymentId: row.id,
      entryDate: paidAt,
      amount,
      method,
      supplierName: row.supplierName,
      createdById: userId,
    });

    // Miroir banque si paiement BANK
    if (method === PaymentMethod.BANK && dto.bankAccountId) {
      await this.prisma.bankTransaction.create({
        data: {
          bankAccountId: dto.bankAccountId,
          type: 'WITHDRAWAL',
          amount,
          description: `Paiement fournisseur — ${row.supplierName}`,
          reference: `supplierPayment:${row.uuid}`,
          occurredAt: paidAt,
          userId: userId ?? null,
        },
      });
    }

    await this.audit.log({
      userId,
      action: 'SUPPLIER_PAYMENT_CREATED',
      entity: 'SupplierPayment',
      entityId: String(row.id),
      metadata: { amount, method, supplierName: row.supplierName },
    });

    return row;
  }

  // ——— Immobilisations ———

  async listFixedAssets(companyId: number) {
    const items = await this.prisma.fixedAsset.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { acquisitionDate: 'desc' }],
    });
    return items.map((a) => this.enrichAsset(a));
  }

  private enrichAsset(a: {
    id: number;
    name: string;
    acquisitionDate: Date;
    acquisitionCost: Prisma.Decimal | number;
    residualValue: Prisma.Decimal | number;
    usefulLifeMonths: number;
    accumulatedDepreciation: Prisma.Decimal | number;
    lastDepreciationPeriod: string | null;
    isActive: boolean;
    note: string | null;
    createdAt: Date;
  }) {
    const cost = Number(a.acquisitionCost);
    const residual = Number(a.residualValue);
    const accum = Number(a.accumulatedDepreciation);
    const depreciable = Math.max(0, cost - residual);
    const monthly =
      a.usefulLifeMonths > 0 ? this.round2(depreciable / a.usefulLifeMonths) : 0;
    const netBook = this.round2(cost - accum);
    return {
      ...a,
      acquisitionCost: cost,
      residualValue: residual,
      accumulatedDepreciation: accum,
      monthlyDepreciation: monthly,
      netBookValue: netBook,
      remainingDepreciable: this.round2(Math.max(0, depreciable - accum)),
    };
  }

  async createFixedAsset(dto: CreateFixedAssetDto, userId?: number) {
    await this.accounting.ensureChartOfAccounts(dto.companyId);
    const cost = this.round2(dto.acquisitionCost);
    if (cost <= 0) throw new BadRequestException('Coût d’acquisition invalide');
    if (dto.usefulLifeMonths < 1) {
      throw new BadRequestException('Durée d’utilité (mois) invalide');
    }
    const residual = this.round2(dto.residualValue ?? 0);
    if (residual >= cost) {
      throw new BadRequestException('Valeur résiduelle doit être < coût');
    }
    const acquisitionDate = this.dateOnly(dto.acquisitionDate.slice(0, 10));
    const paidFrom = dto.paidFrom ?? 'CASH';

    if (paidFrom === 'BANK') {
      if (dto.bankAccountId == null || dto.bankAccountId < 1) {
        throw new BadRequestException('Compte bancaire requis pour un financement banque');
      }
      const acc = await this.prisma.bankAccount.findFirst({
        where: {
          id: dto.bankAccountId,
          companyId: dto.companyId,
          deletedAt: null,
          isActive: true,
        },
      });
      if (!acc) throw new BadRequestException('Compte bancaire introuvable');
    }

    const asset = await this.prisma.fixedAsset.create({
      data: {
        companyId: dto.companyId,
        name: dto.name.trim(),
        acquisitionDate,
        acquisitionCost: cost,
        residualValue: residual,
        usefulLifeMonths: dto.usefulLifeMonths,
        note: dto.note?.trim() || null,
        createdById: userId ?? null,
      },
    });

    await this.posting.postFixedAssetAcquisition({
      companyId: dto.companyId,
      fixedAssetId: asset.id,
      entryDate: acquisitionDate,
      amount: cost,
      assetName: asset.name,
      paidFrom,
      createdById: userId,
    });

    if (paidFrom === 'BANK' && dto.bankAccountId) {
      await this.prisma.bankTransaction.create({
        data: {
          bankAccountId: dto.bankAccountId,
          type: 'WITHDRAWAL',
          amount: cost,
          description: `Acquisition immobilisation — ${asset.name}`,
          reference: `fixedAsset:${asset.uuid}`,
          occurredAt: acquisitionDate,
          userId: userId ?? null,
        },
      });
    }

    await this.audit.log({
      userId,
      action: 'FIXED_ASSET_CREATED',
      entity: 'FixedAsset',
      entityId: String(asset.id),
      metadata: { cost, paidFrom },
    });

    return this.enrichAsset(asset);
  }

  /**
   * Passe les dotations du mois pour toutes les immobilisations actives
   * (ou une seule si fixedAssetId fourni).
   */
  async runDepreciation(dto: RunDepreciationDto, userId?: number) {
    await this.accounting.ensureChartOfAccounts(dto.companyId);
    const period = this.periodFromYmd(dto.period);
    const entryDate = this.monthEndDate(period);

    const where: Prisma.FixedAssetWhereInput = {
      companyId: dto.companyId,
      deletedAt: null,
      isActive: true,
    };
    if (dto.fixedAssetId != null) where.id = dto.fixedAssetId;

    const assets = await this.prisma.fixedAsset.findMany({ where });
    const results: Array<{
      assetId: number;
      name: string;
      amount: number;
      status: 'posted' | 'skipped' | 'fully_depreciated';
    }> = [];

    for (const asset of assets) {
      const enriched = this.enrichAsset(asset);
      if (enriched.remainingDepreciable < 0.01) {
        results.push({
          assetId: asset.id,
          name: asset.name,
          amount: 0,
          status: 'fully_depreciated',
        });
        continue;
      }
      if (asset.lastDepreciationPeriod && asset.lastDepreciationPeriod >= period) {
        results.push({
          assetId: asset.id,
          name: asset.name,
          amount: 0,
          status: 'skipped',
        });
        continue;
      }
      // Ne pas amortir avant le mois d’acquisition
      const acqPeriod = asset.acquisitionDate.toISOString().slice(0, 7);
      if (period < acqPeriod) {
        results.push({
          assetId: asset.id,
          name: asset.name,
          amount: 0,
          status: 'skipped',
        });
        continue;
      }

      const amount = Math.min(enriched.monthlyDepreciation, enriched.remainingDepreciable);
      try {
        await this.posting.postDepreciation({
          companyId: dto.companyId,
          fixedAssetId: asset.id,
          period,
          entryDate,
          amount,
          assetName: asset.name,
          createdById: userId,
        });
        await this.prisma.fixedAsset.update({
          where: { id: asset.id },
          data: {
            accumulatedDepreciation: this.round2(
              Number(asset.accumulatedDepreciation) + amount,
            ),
            lastDepreciationPeriod: period,
          },
        });
        results.push({
          assetId: asset.id,
          name: asset.name,
          amount,
          status: 'posted',
        });
      } catch (err) {
        // exercice non ouvert etc.
        throw err instanceof BadRequestException
          ? err
          : new BadRequestException(
              err instanceof Error ? err.message : 'Échec amortissement',
            );
      }
    }

    await this.audit.log({
      userId,
      action: 'DEPRECIATION_RUN',
      entity: 'FixedAsset',
      entityId: period,
      metadata: { companyId: dto.companyId, results },
    });

    return { period, results };
  }
}
