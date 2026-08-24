import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankTransactionType, Prisma } from '@prisma/client';
import { USER_ATTRIBUTION_SELECT } from '../../common/user-attribution';
import { ymdToDateStart } from '../../common/time/timezone';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateBankAccountDto,
  CreateBankDto,
  CreateBankTransactionDto,
  UpdateBankAccountDto,
  UpdateBankDto,
} from './dto/banks.dto';

@Injectable()
export class BanksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  private async ensureCompany(companyId: number) {
    const c = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
    });
    if (!c) throw new NotFoundException('Entreprise introuvable');
    return c;
  }

  async listBanks(companyId: number, includeInactive = false) {
    await this.ensureCompany(companyId);
    // Répare les dépôts manquants (paiements BANK sans BankTransaction).
    await this.reconcileMissingDeposits(companyId);
    const banks = await this.prisma.bank.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        accounts: {
          where: {
            deletedAt: null,
            ...(includeInactive ? {} : { isActive: true }),
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const accountIds = banks.flatMap((b) => b.accounts.map((a) => a.id));
    const balances = await this.balancesByAccountIds(accountIds);

    return banks.map((b) => ({
      id: b.id,
      uuid: b.uuid,
      companyId: b.companyId,
      name: b.name,
      note: b.note,
      isActive: b.isActive,
      createdAt: b.createdAt,
      accounts: b.accounts.map((a) => {
        const bal = balances.get(a.id) ?? Number(a.openingBalance);
        return {
          id: a.id,
          uuid: a.uuid,
          bankId: a.bankId,
          companyId: a.companyId,
          name: a.name,
          accountNumber: a.accountNumber,
          openingBalance: Number(a.openingBalance),
          balance: this.round2(bal),
          isActive: a.isActive,
          note: a.note,
        };
      }),
    }));
  }

  async createBank(dto: CreateBankDto, userId?: number) {
    await this.ensureCompany(dto.companyId);
    const row = await this.prisma.bank.create({
      data: {
        companyId: dto.companyId,
        name: dto.name.trim(),
        note: dto.note?.trim() || null,
      },
    });
    await this.auditService.log({
      userId,
      action: 'BANK_CREATED',
      entity: 'Bank',
      entityId: String(row.id),
      metadata: { name: row.name, companyId: row.companyId },
    });
    return row;
  }

  async updateBank(id: number, dto: UpdateBankDto, userId?: number) {
    const existing = await this.prisma.bank.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Banque introuvable');
    const updated = await this.prisma.bank.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.auditService.log({
      userId,
      action: 'BANK_UPDATED',
      entity: 'Bank',
      entityId: String(id),
    });
    return updated;
  }

  async createAccount(dto: CreateBankAccountDto, userId?: number) {
    const bank = await this.prisma.bank.findFirst({
      where: { id: dto.bankId, deletedAt: null },
    });
    if (!bank) throw new NotFoundException('Banque introuvable');
    if (!bank.isActive) throw new BadRequestException('Banque inactive');

    const row = await this.prisma.bankAccount.create({
      data: {
        bankId: bank.id,
        companyId: bank.companyId,
        name: dto.name.trim(),
        accountNumber: dto.accountNumber?.trim() || null,
        openingBalance: dto.openingBalance ?? 0,
        note: dto.note?.trim() || null,
      },
    });
    await this.auditService.log({
      userId,
      action: 'BANK_ACCOUNT_CREATED',
      entity: 'BankAccount',
      entityId: String(row.id),
      metadata: { bankId: bank.id, name: row.name },
    });
    return row;
  }

  async updateAccount(id: number, dto: UpdateBankAccountDto, userId?: number) {
    const existing = await this.prisma.bankAccount.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Compte bancaire introuvable');
    const updated = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.accountNumber !== undefined
          ? { accountNumber: dto.accountNumber?.trim() || null }
          : {}),
        ...(dto.openingBalance !== undefined ? { openingBalance: dto.openingBalance } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.auditService.log({
      userId,
      action: 'BANK_ACCOUNT_UPDATED',
      entity: 'BankAccount',
      entityId: String(id),
    });
    return updated;
  }

  async summary(companyId: number) {
    const banks = await this.listBanks(companyId, false);
    const accounts = banks.flatMap((b) =>
      b.accounts.map((a) => ({
        ...a,
        bankName: b.name,
        bankId: b.id,
      })),
    );
    const totalCapital = this.round2(accounts.reduce((s, a) => s + a.balance, 0));
    const activeAccounts = accounts.filter((a) => a.isActive);
    return {
      banksCount: banks.length,
      accountsCount: activeAccounts.length,
      totalCapital,
      accounts: activeAccounts.sort((a, b) => b.balance - a.balance),
      byBank: banks.map((b) => ({
        id: b.id,
        name: b.name,
        accountsCount: b.accounts.length,
        balance: this.round2(b.accounts.reduce((s, a) => s + a.balance, 0)),
      })),
    };
  }

  async listTransactions(opts: {
    companyId: number;
    bankAccountId?: number;
    skip?: number;
    take?: number;
  }) {
    await this.ensureCompany(opts.companyId);
    const skip = Math.max(0, Math.floor(opts.skip ?? 0));
    const take = Math.min(100, Math.max(1, Math.floor(opts.take ?? 20)));

    const where: Prisma.BankTransactionWhereInput = {
      deletedAt: null,
      bankAccount: {
        companyId: opts.companyId,
        deletedAt: null,
        ...(opts.bankAccountId ? { id: opts.bankAccountId } : {}),
      },
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.bankTransaction.count({ where }),
      this.prisma.bankTransaction.findMany({
        where,
        include: {
          user: { select: USER_ATTRIBUTION_SELECT },
          bankAccount: {
            select: {
              id: true,
              name: true,
              accountNumber: true,
              bank: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount),
        description: r.description,
        reference: r.reference,
        occurredAt: r.occurredAt,
        createdAt: r.createdAt,
        user: r.user,
        bankAccount: r.bankAccount,
      })),
    };
  }

  async createTransaction(dto: CreateBankTransactionDto, userId?: number) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, deletedAt: null },
      include: { bank: true },
    });
    if (!account) throw new NotFoundException('Compte bancaire introuvable');
    if (!account.isActive) throw new BadRequestException('Compte bancaire inactif');
    if (!account.bank.isActive) throw new BadRequestException('Banque inactive');

    const amount = this.round2(dto.amount);
    if (amount <= 0) throw new BadRequestException('Montant invalide');

    let occurredAt = new Date();
    if (dto.occurredOn?.trim()) {
      try {
        occurredAt = ymdToDateStart(dto.occurredOn.trim());
      } catch {
        throw new BadRequestException('occurredOn invalide (YYYY-MM-DD)');
      }
    }

    const row = await this.prisma.bankTransaction.create({
      data: {
        bankAccountId: account.id,
        type: dto.type,
        amount,
        description: dto.description.trim(),
        reference: dto.reference?.trim() || null,
        occurredAt,
        userId: userId ?? null,
      },
      include: {
        user: { select: USER_ATTRIBUTION_SELECT },
        bankAccount: {
          select: {
            id: true,
            name: true,
            bank: { select: { id: true, name: true } },
          },
        },
      },
    });

    await this.accountingPosting.postBankTransaction({
      companyId: account.companyId,
      transactionId: row.id,
      entryDate: occurredAt,
      amount,
      type: dto.type,
      description: dto.description.trim(),
      createdById: userId,
    });

    await this.auditService.log({
      userId,
      action: 'BANK_TRANSACTION_CREATED',
      entity: 'BankTransaction',
      entityId: String(row.id),
      metadata: {
        type: row.type,
        amount,
        bankAccountId: account.id,
      },
    });

    const balMap = await this.balancesByAccountIds([account.id]);
    return {
      transaction: {
        id: row.id,
        type: row.type,
        amount: Number(row.amount),
        description: row.description,
        reference: row.reference,
        occurredAt: row.occurredAt,
        user: row.user,
        bankAccount: row.bankAccount,
      },
      accountBalance: this.round2(balMap.get(account.id) ?? Number(account.openingBalance)),
    };
  }

  async softDeleteTransaction(id: number, companyId: number, userId?: number) {
    const row = await this.prisma.bankTransaction.findFirst({
      where: {
        id,
        deletedAt: null,
        bankAccount: { companyId, deletedAt: null },
      },
    });
    if (!row) throw new NotFoundException('Transaction introuvable');
    await this.prisma.bankTransaction.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.log({
      userId,
      action: 'BANK_TRANSACTION_DELETED',
      entity: 'BankTransaction',
      entityId: String(id),
    });
    return { ok: true };
  }

  private async balancesByAccountIds(ids: number[]) {
    const map = new Map<number, number>();
    if (!ids.length) return map;

    const accounts = await this.prisma.bankAccount.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, openingBalance: true },
    });
    for (const a of accounts) {
      map.set(a.id, Number(a.openingBalance));
    }

    const grouped = await this.prisma.bankTransaction.groupBy({
      by: ['bankAccountId', 'type'],
      where: {
        bankAccountId: { in: ids },
        deletedAt: null,
      },
      _sum: { amount: true },
    });

    for (const g of grouped) {
      const cur = map.get(g.bankAccountId) ?? 0;
      const sum = Number(g._sum.amount ?? 0);
      if (g.type === BankTransactionType.DEPOSIT) {
        map.set(g.bankAccountId, cur + sum);
      } else {
        map.set(g.bankAccountId, cur - sum);
      }
    }
    return map;
  }

  /**
   * Crée les BankTransaction DEPOSIT manquants pour les paiements BANK
   * (POS + crédit) qui ont déjà un bankAccountId. Idempotent via reference.
   */
  async reconcileMissingDeposits(companyId: number): Promise<number> {
    let created = 0;

    const payments = await this.prisma.payment.findMany({
      where: {
        deletedAt: null,
        method: 'BANK',
        bankAccountId: { not: null },
        amount: { gt: 0.009 },
        bankAccount: { companyId, deletedAt: null },
        sale: { deletedAt: null, status: 'COMPLETED' },
      },
      select: {
        id: true,
        amount: true,
        bankAccountId: true,
        saleId: true,
        createdAt: true,
        sale: { select: { id: true, txnNumber: true } },
        bankAccount: {
          select: { id: true, name: true, bank: { select: { name: true } } },
        },
      },
      take: 500,
      orderBy: { id: 'asc' },
    });

    for (const p of payments) {
      if (p.bankAccountId == null || !p.bankAccount) continue;
      const txnRef =
        p.sale.txnNumber != null ? `saleTxn:${p.sale.txnNumber}` : `sale:${p.saleId}`;
      const refs = [`sale:${p.saleId}`, txnRef];
      const existing = await this.prisma.bankTransaction.findFirst({
        where: {
          deletedAt: null,
          type: BankTransactionType.DEPOSIT,
          reference: { in: refs },
        },
        select: { id: true },
      });
      if (existing) continue;
      await this.prisma.bankTransaction.create({
        data: {
          bankAccountId: p.bankAccountId,
          type: BankTransactionType.DEPOSIT,
          amount: p.amount,
          description: `Vente #${p.sale.txnNumber ?? p.saleId} — ${p.bankAccount.bank.name} / ${p.bankAccount.name}`,
          reference: txnRef,
          occurredAt: p.createdAt,
        },
      });
      created += 1;
    }

    const creditPays = await this.prisma.creditPayment.findMany({
      where: {
        deletedAt: null,
        method: 'BANK',
        bankAccountId: { not: null },
        amount: { gt: 0.009 },
        bankAccount: { companyId, deletedAt: null },
      },
      select: {
        id: true,
        uuid: true,
        amount: true,
        bankAccountId: true,
        createdAt: true,
        userId: true,
        creditCustomer: { select: { name: true } },
        bankAccount: {
          select: { id: true, name: true, bank: { select: { name: true } } },
        },
      },
      take: 500,
      orderBy: { id: 'asc' },
    });

    for (const cp of creditPays) {
      if (cp.bankAccountId == null || !cp.bankAccount) continue;
      const ref = `creditPayment:${cp.uuid}`;
      const existing = await this.prisma.bankTransaction.findFirst({
        where: {
          deletedAt: null,
          type: BankTransactionType.DEPOSIT,
          reference: ref,
        },
        select: { id: true },
      });
      if (existing) continue;
      await this.prisma.bankTransaction.create({
        data: {
          bankAccountId: cp.bankAccountId,
          type: BankTransactionType.DEPOSIT,
          amount: cp.amount,
          description: `Remboursement crédit — ${cp.creditCustomer.name} — ${cp.bankAccount.bank.name} / ${cp.bankAccount.name}`,
          reference: ref,
          occurredAt: cp.createdAt,
          userId: cp.userId,
        },
      });
      created += 1;
    }

    return created;
  }
}
