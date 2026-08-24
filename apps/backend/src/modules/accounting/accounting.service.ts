import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountNature,
  FiscalYearStatus,
  JournalCode,
  JournalEntryStatus,
  Prisma,
} from '@prisma/client';
import {
  ymdToBusinessDayEnd,
  ymdToBusinessDayStart,
} from '../../common/utils/business-timezone';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingPostingService } from './accounting-posting.service';
import {
  CHART_EDIT_DISABLED_MESSAGE,
  isChartOfAccountsEditEnabled,
} from './chart-edit.policy';
import { DEFAULT_CHART_OF_ACCOUNTS } from './chart-of-accounts';
import {
  CreateAccountDto,
  CreateFiscalYearDto,
  CreateManualEntryDto,
  UpdateAccountDto,
} from './dto/accounting.dto';

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: AccountingPostingService,
  ) {}

  private parseYmd(ymd: string, end = false): Date {
    try {
      return end ? ymdToBusinessDayEnd(ymd) : ymdToBusinessDayStart(ymd);
    } catch {
      throw new BadRequestException('Date invalide (YYYY-MM-DD)');
    }
  }

  private dateOnlyFromYmd(ymd: string): Date {
    const d = this.parseYmd(ymd, false);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  // ——— Plan comptable ———

  private async fetchAccounts(
    companyId: number,
    opts?: { includeInactive?: boolean },
  ) {
    return this.prisma.account.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(opts?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ classNumber: 'asc' }, { code: 'asc' }],
    });
  }

  async ensureChartOfAccounts(companyId: number) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable');

    const existing = await this.prisma.account.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, code: true, systemKey: true, isSystem: true, isActive: true },
    });
    const byCode = new Map(existing.map((a) => [a.code, a]));
    const bySystemKey = new Map(
      existing.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]),
    );

    let created = 0;
    let restoredKeys = 0;

    for (const def of DEFAULT_CHART_OF_ACCOUNTS) {
      const found = byCode.get(def.code);
      if (!found) {
        // Ne pas recréer un code si la clé système existe déjà sous un autre code (renommé)
        if (def.systemKey && bySystemKey.has(def.systemKey)) {
          continue;
        }
        await this.prisma.account.create({
          data: {
            companyId,
            code: def.code,
            name: def.name,
            classNumber: def.classNumber,
            nature: def.nature,
            isDebitNormal: def.isDebitNormal,
            systemKey: def.systemKey ?? null,
            isSystem: Boolean(def.systemKey),
            isActive: true,
          },
        });
        created += 1;
        continue;
      }
      // Rétablir systemKey manquant sur le code d’origine (ne pas écraser un rename utilisateur)
      if (def.systemKey && !found.systemKey && !bySystemKey.has(def.systemKey)) {
        await this.prisma.account.update({
          where: { id: found.id },
          data: { systemKey: def.systemKey, isSystem: true },
        });
        restoredKeys += 1;
        bySystemKey.set(def.systemKey, found);
      }
    }

    if (existing.length === 0 && created > 0) {
      await this.audit.log({
        action: 'ACCOUNTING_CHART_INITIALIZED',
        entity: 'Account',
        entityId: String(companyId),
        metadata: { count: created },
      });
    } else if (created > 0 || restoredKeys > 0) {
      await this.audit.log({
        action: 'ACCOUNTING_CHART_SYNCED',
        entity: 'Account',
        entityId: String(companyId),
        metadata: { created, restoredKeys },
      });
    }

    return this.fetchAccounts(companyId, { includeInactive: true });
  }

  async listAccounts(companyId: number, opts?: { includeInactive?: boolean }) {
    await this.ensureChartOfAccounts(companyId);
    return this.fetchAccounts(companyId, { includeInactive: opts?.includeInactive ?? true });
  }

  private inferNatureAndSide(classNumber: number, dto?: { nature?: AccountNature | 'BALANCE_SHEET' | 'INCOME_STATEMENT'; isDebitNormal?: boolean }) {
    if (classNumber < 1 || classNumber > 7) {
      throw new BadRequestException('Classe comptable entre 1 et 7');
    }
    const nature =
      (dto?.nature as AccountNature | undefined) ??
      (classNumber <= 5 ? AccountNature.BALANCE_SHEET : AccountNature.INCOME_STATEMENT);
    const isDebitNormal =
      dto?.isDebitNormal ??
      (classNumber === 6 || classNumber === 2 || classNumber === 3 || classNumber === 5
        ? true
        : classNumber === 7 || classNumber === 1
          ? false
          : true);
    return { nature, isDebitNormal };
  }

  private assertChartEditAllowed() {
    if (!isChartOfAccountsEditEnabled()) {
      throw new ForbiddenException(CHART_EDIT_DISABLED_MESSAGE);
    }
  }

  async createAccount(dto: CreateAccountDto) {
    this.assertChartEditAllowed();
    await this.ensureChartOfAccounts(dto.companyId);
    const code = dto.code.trim();
    const { nature, isDebitNormal } = this.inferNatureAndSide(dto.classNumber, dto);

    try {
      return await this.prisma.account.create({
        data: {
          companyId: dto.companyId,
          code,
          name: dto.name.trim(),
          classNumber: dto.classNumber,
          nature,
          isDebitNormal,
          isSystem: false,
          isActive: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`Le compte ${code} existe déjà`);
      }
      throw e;
    }
  }

  async updateAccount(id: number, dto: UpdateAccountDto) {
    this.assertChartEditAllowed();
    const acc = await this.prisma.account.findFirst({
      where: { id, deletedAt: null },
    });
    if (!acc) throw new NotFoundException('Compte introuvable');

    const classNumber = dto.classNumber ?? acc.classNumber;
    const inferred = this.inferNatureAndSide(classNumber, {
      nature: dto.nature ?? acc.nature,
      isDebitNormal: dto.isDebitNormal ?? acc.isDebitNormal,
    });

    const code = dto.code?.trim() ?? acc.code;
    if (!code) throw new BadRequestException('Code invalide');

    try {
      const updated = await this.prisma.account.update({
        where: { id },
        data: {
          code,
          name: dto.name?.trim() ?? acc.name,
          classNumber,
          nature: inferred.nature,
          isDebitNormal: inferred.isDebitNormal,
          ...(dto.isActive != null ? { isActive: dto.isActive } : {}),
          // systemKey / isSystem : immuables (auto-imputation ventes, caisse, etc.)
        },
      });
      await this.audit.log({
        action: 'ACCOUNT_UPDATED',
        entity: 'Account',
        entityId: String(id),
        metadata: { code: updated.code, name: updated.name, isActive: updated.isActive },
      });
      return updated;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`Le compte ${code} existe déjà`);
      }
      throw e;
    }
  }

  /**
   * Retire un compte du plan :
   * - sans mouvements → soft-delete
   * - avec mouvements → désactivation (historique conservé)
   * - comptes système → désactivation seule (jamais de suppression)
   */
  async removeAccount(id: number) {
    this.assertChartEditAllowed();
    const acc = await this.prisma.account.findFirst({
      where: { id, deletedAt: null },
    });
    if (!acc) throw new NotFoundException('Compte introuvable');

    const lineCount = await this.prisma.journalLine.count({
      where: { accountId: id },
    });

    if (acc.isSystem || acc.systemKey) {
      if (!acc.isActive && lineCount > 0) {
        throw new BadRequestException(
          'Compte système déjà inactif. Il reste lié à des écritures — impossible de le supprimer.',
        );
      }
      const updated = await this.prisma.account.update({
        where: { id },
        data: { isActive: false },
      });
      await this.audit.log({
        action: 'ACCOUNT_DEACTIVATED',
        entity: 'Account',
        entityId: String(id),
        metadata: { reason: 'system', code: acc.code },
      });
      return {
        account: updated,
        action: 'deactivated' as const,
        message:
          'Compte système désactivé. L’auto-imputation qui l’utilise (ventes, caisse, clients…) échouera jusqu’à réactivation ou réaffectation.',
      };
    }

    if (lineCount > 0) {
      const updated = await this.prisma.account.update({
        where: { id },
        data: { isActive: false },
      });
      await this.audit.log({
        action: 'ACCOUNT_DEACTIVATED',
        entity: 'Account',
        entityId: String(id),
        metadata: { reason: 'has_movements', lines: lineCount },
      });
      return {
        account: updated,
        action: 'deactivated' as const,
        message: `Compte désactivé (${lineCount} mouvement(s) conservés dans l’historique).`,
      };
    }

    const updated = await this.prisma.account.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.log({
      action: 'ACCOUNT_DELETED',
      entity: 'Account',
      entityId: String(id),
      metadata: { code: acc.code },
    });
    return {
      account: updated,
      action: 'deleted' as const,
      message: 'Compte retiré du plan comptable.',
    };
  }

  // ——— Exercices ———

  async listFiscalYears(companyId: number) {
    return this.prisma.fiscalYear.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { startDate: 'desc' },
      include: {
        closedBy: { select: { id: true, fullName: true, phone: true } },
        _count: { select: { entries: true } },
      },
    });
  }

  async getOpenFiscalYear(companyId: number) {
    return this.prisma.fiscalYear.findFirst({
      where: { companyId, deletedAt: null, status: FiscalYearStatus.OPEN },
      orderBy: { startDate: 'desc' },
    });
  }

  async createFiscalYear(dto: CreateFiscalYearDto, userId?: number) {
    const startDate = this.dateOnlyFromYmd(dto.startDate.slice(0, 10));
    const endDate = this.dateOnlyFromYmd(dto.endDate.slice(0, 10));
    if (endDate < startDate) {
      throw new BadRequestException('La date de fin doit être après la date de début');
    }

    const overlap = await this.prisma.fiscalYear.findFirst({
      where: {
        companyId: dto.companyId,
        deletedAt: null,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlap) {
      throw new BadRequestException(
        `Chevauchement avec l’exercice « ${overlap.label} » (${overlap.status})`,
      );
    }

    const open = await this.getOpenFiscalYear(dto.companyId);
    if (open) {
      throw new BadRequestException(
        `Un exercice est déjà ouvert (« ${open.label} »). Clôturez-le avant d’en ouvrir un autre.`,
      );
    }

    await this.ensureChartOfAccounts(dto.companyId);

    const fy = await this.prisma.fiscalYear.create({
      data: {
        companyId: dto.companyId,
        label: dto.label.trim(),
        startDate,
        endDate,
        status: FiscalYearStatus.OPEN,
      },
    });

    await this.audit.log({
      userId,
      action: 'FISCAL_YEAR_OPENED',
      entity: 'FiscalYear',
      entityId: String(fy.id),
      metadata: { label: fy.label, startDate: dto.startDate, endDate: dto.endDate },
    });

    return fy;
  }

  /**
   * Clôture d’exercice : solde les comptes 6/7 vers 120 Résultat, puis fige l’exercice.
   */
  async closeFiscalYear(fiscalYearId: number, userId?: number) {
    const fy = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, deletedAt: null },
    });
    if (!fy) throw new NotFoundException('Exercice introuvable');
    if (fy.status === FiscalYearStatus.CLOSED) {
      throw new BadRequestException('Exercice déjà clôturé');
    }

    const companyId = fy.companyId;
    const from = fy.startDate;
    const to = fy.endDate;

    const lines = await this.prisma.journalLine.findMany({
      where: {
        journalEntry: {
          companyId,
          fiscalYearId: fy.id,
          status: JournalEntryStatus.POSTED,
          deletedAt: null,
          entryDate: { gte: from, lte: to },
        },
        account: { classNumber: { in: [6, 7] }, deletedAt: null },
      },
      include: { account: true },
    });

    const byAccount = new Map<
      number,
      { code: string; classNumber: number; debit: number; credit: number }
    >();
    for (const l of lines) {
      const cur = byAccount.get(l.accountId) ?? {
        code: l.account.code,
        classNumber: l.account.classNumber,
        debit: 0,
        credit: 0,
      };
      cur.debit += Number(l.debit);
      cur.credit += Number(l.credit);
      byAccount.set(l.accountId, cur);
    }

    const closingLines: { accountCode: string; debit?: number; credit?: number; label?: string }[] =
      [];
    let charges = 0;
    let produits = 0;

    for (const [, row] of byAccount) {
      if (row.classNumber === 6) {
        const bal = Math.round((row.debit - row.credit) * 100) / 100;
        if (Math.abs(bal) < 0.01) continue;
        if (bal > 0) {
          closingLines.push({ accountCode: row.code, credit: bal, label: 'Clôture charges' });
          charges += bal;
        } else {
          closingLines.push({ accountCode: row.code, debit: -bal, label: 'Clôture charges' });
          charges += bal;
        }
      } else if (row.classNumber === 7) {
        const bal = Math.round((row.credit - row.debit) * 100) / 100;
        if (Math.abs(bal) < 0.01) continue;
        if (bal > 0) {
          closingLines.push({ accountCode: row.code, debit: bal, label: 'Clôture produits' });
          produits += bal;
        } else {
          closingLines.push({ accountCode: row.code, credit: -bal, label: 'Clôture produits' });
          produits += bal;
        }
      }
    }

    charges = Math.round(charges * 100) / 100;
    produits = Math.round(produits * 100) / 100;
    const resultat = Math.round((produits - charges) * 100) / 100;

    if (closingLines.length > 0 || Math.abs(resultat) >= 0.01) {
      if (resultat >= 0) {
        closingLines.push({
          accountCode: '120',
          credit: Math.abs(resultat),
          label: 'Résultat net (bénéfice)',
        });
      } else {
        closingLines.push({
          accountCode: '120',
          debit: Math.abs(resultat),
          label: 'Résultat net (perte)',
        });
      }

      await this.posting.postEntry({
        companyId,
        entryDate: to,
        journalCode: JournalCode.OD,
        description: `Clôture de l’exercice ${fy.label}`,
        source: 'CLOSING',
        sourceId: String(fy.id),
        lines: closingLines.map((l) => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit,
          label: l.label,
        })),
        createdById: userId,
      });
    }

    const closed = await this.prisma.fiscalYear.update({
      where: { id: fy.id },
      data: {
        status: FiscalYearStatus.CLOSED,
        closedAt: new Date(),
        closedById: userId ?? null,
      },
    });

    await this.audit.log({
      userId,
      action: 'FISCAL_YEAR_CLOSED',
      entity: 'FiscalYear',
      entityId: String(fy.id),
      metadata: { label: fy.label, resultat },
    });

    return { fiscalYear: closed, resultat };
  }

  // ——— Journal ———

  async listJournal(params: {
    companyId: number;
    fiscalYearId?: number;
    dateFrom?: string;
    dateTo?: string;
    journalCode?: JournalCode;
    skip?: number;
    take?: number;
  }) {
    const skip = Math.max(0, params.skip ?? 0);
    const take = Math.min(200, Math.max(1, params.take ?? 50));

    let fiscalYearId = params.fiscalYearId;
    if (fiscalYearId == null) {
      const open = await this.getOpenFiscalYear(params.companyId);
      if (!open) {
        return { items: [], total: 0, fiscalYear: null };
      }
      fiscalYearId = open.id;
    }

    const fy = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId: params.companyId, deletedAt: null },
    });
    if (!fy) throw new NotFoundException('Exercice introuvable');

    const where: Prisma.JournalEntryWhereInput = {
      companyId: params.companyId,
      fiscalYearId,
      deletedAt: null,
      status: JournalEntryStatus.POSTED,
    };
    if (params.journalCode) where.journalCode = params.journalCode;
    if (params.dateFrom || params.dateTo) {
      where.entryDate = {};
      if (params.dateFrom) {
        const from = this.dateOnlyFromYmd(params.dateFrom);
        if (from < fy.startDate || from > fy.endDate) {
          throw new BadRequestException('dateFrom hors de l’exercice sélectionné');
        }
        where.entryDate.gte = from;
      }
      if (params.dateTo) {
        const to = this.dateOnlyFromYmd(params.dateTo);
        if (to < fy.startDate || to > fy.endDate) {
          throw new BadRequestException('dateTo hors de l’exercice sélectionné');
        }
        where.entryDate.lte = to;
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
        skip,
        take,
        include: {
          lines: {
            orderBy: { sortOrder: 'asc' },
            include: { account: { select: { id: true, code: true, name: true } } },
          },
          createdBy: { select: { id: true, fullName: true, phone: true } },
        },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { items, total, fiscalYear: fy };
  }

  async createManualEntry(dto: CreateManualEntryDto, userId?: number) {
    await this.ensureChartOfAccounts(dto.companyId);
    return this.posting.postEntry({
      companyId: dto.companyId,
      entryDate: this.dateOnlyFromYmd(dto.entryDate.slice(0, 10)),
      journalCode: dto.journalCode ?? JournalCode.OD,
      description: dto.description.trim(),
      reference: dto.reference?.trim() || null,
      source: 'MANUAL',
      sourceId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      lines: dto.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
        label: l.label,
      })),
      createdById: userId,
    });
  }

  async overview(companyId: number) {
    // Les exercices doivent remonter même si l’init du plan comptable échoue.
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable');

    const fiscalYears = await this.listFiscalYears(companyId);
    const open = fiscalYears.find((f) => f.status === FiscalYearStatus.OPEN) ?? null;

    let accountCount = 0;
    try {
      await this.ensureChartOfAccounts(companyId);
      accountCount = await this.prisma.account.count({
        where: { companyId, deletedAt: null, isActive: true },
      });
    } catch {
      accountCount = await this.prisma.account.count({
        where: { companyId, deletedAt: null, isActive: true },
      });
    }

    let entryCount = 0;
    if (open) {
      entryCount = await this.prisma.journalEntry.count({
        where: {
          companyId,
          fiscalYearId: open.id,
          deletedAt: null,
          status: JournalEntryStatus.POSTED,
        },
      });
    }

    // Dates DATE Prisma → YYYY-MM-DD stables pour l’UI (évite décalages TZ).
    const mapFy = <T extends { startDate: Date; endDate: Date }>(fy: T) => ({
      ...fy,
      startDate: fy.startDate.toISOString().slice(0, 10),
      endDate: fy.endDate.toISOString().slice(0, 10),
    });

    return {
      openFiscalYear: open ? mapFy(open) : null,
      fiscalYears: fiscalYears.map(mapFy),
      accountCount,
      entryCount,
    };
  }
}
