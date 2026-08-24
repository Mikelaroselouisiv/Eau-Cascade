/**
 * Seed DÉMO local UNIQUEMENT — Docker Postgres Eau Cascade (127.0.0.1:5434 / pos_eau_cascade).
 *
 * Ne jamais pointer vers GCP / Frères / autre machine.
 *
 * Usage :
 *   cd apps/backend
 *   npx ts-node prisma/seed-demo-dev.ts
 *
 * Compte admin : +50937000001 / admin1234
 */
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import { resolve } from 'path';
import {
  FinanceType,
  GoodsReceiptStatus,
  JournalCode,
  JournalEntryStatus,
  MovementType,
  PaymentMethod,
  PrismaClient,
  PurchaseOrderStatus,
} from '@prisma/client';
import {
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLE_LABELS,
} from '../src/common/permissions';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../src/modules/accounting/chart-of-accounts';

config({ path: resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

const ADMIN_PHONE = '+50937000001';
const ADMIN_PASSWORD = 'admin1234';
const CASHIER_PHONE = '+50937000002';
const ACCOUNTANT_PHONE = '+50937000003';
const DEMO_TAX_ID = 'DEMO-NIF-LOCAL-001';

function assertLocalDevDatabase() {
  const url = process.env.DATABASE_URL ?? '';
  const u = url.toLowerCase();

  const isLocalPort =
    u.includes('127.0.0.1:5434') ||
    u.includes('localhost:5434') ||
    u.includes('host.docker.internal:5434');

  if (!isLocalPort) {
    throw new Error(
      `REFUSÉ — seed démo uniquement sur Postgres Docker local :5434.\nURL actuelle: ${url.replace(/:[^:@/]+@/, ':***@')}`,
    );
  }
  if (!u.includes('/pos_eau_cascade')) {
    throw new Error('REFUSÉ — la base doit s’appeler pos_eau_cascade (projet Eau Cascade local).');
  }

  const forbidden = [
    'cloudsql',
    'googleapis',
    'gcp.',
    'amazonaws',
    'neon.tech',
    'supabase',
    'freres',
    'bazile',
    'baziles',
    '34.',
    '35.',
  ];
  for (const f of forbidden) {
    if (u.includes(f)) {
      throw new Error(`REFUSÉ — URL base suspecte (mot-clé « ${f} »). Aucun seed hors machine locale.`);
    }
  }

  console.log('✓ Garde locale OK — DATABASE_URL pointe vers Docker 127.0.0.1:5434 / pos_eau_cascade');
}

async function ensureRoles() {
  for (const [code, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const existing = await prisma.appRole.findFirst({ where: { code } });
    if (!existing) {
      await prisma.appRole.create({
        data: {
          code,
          label: SYSTEM_ROLE_LABELS[code] ?? code,
          permissions: perms,
          isSystem: true,
          isActive: true,
        },
      });
    } else if (!existing.permissions.includes('*')) {
      const merged = Array.from(new Set([...existing.permissions, ...perms]));
      await prisma.appRole.update({
        where: { id: existing.id },
        data: { permissions: merged, isActive: true, deletedAt: null },
      });
    }
  }
}

async function wipeLocalDemoData() {
  console.log('… Nettoyage des données métier locales (TRUNCATE CASCADE)…');
  // Ordre sûr : tout ce qui est métier. Pas de sync vers l’extérieur.
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('_prisma_migrations')
      ) LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
  console.log('✓ Base locale vidée (tables métier)');
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}

function utcDate(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day));
}

async function main() {
  assertLocalDevDatabase();

  // Vérifie réellement le serveur (pas juste l’URL du .env)
  const info = await prisma.$queryRaw<Array<{ db: string; addr: string | null; port: number | null }>>`
    SELECT current_database() AS db,
           inet_server_addr()::text AS addr,
           inet_server_port() AS port
  `;
  const row = info[0];
  console.log(`✓ Connecté à db=${row?.db} addr=${row?.addr ?? 'local'} port=${row?.port ?? '?'}`);
  if (row?.db !== 'pos_eau_cascade') {
    throw new Error(`REFUSÉ — database courante = ${row?.db}, attendu pos_eau_cascade`);
  }

  const companyCount = await prisma.company.count();
  if (companyCount > 0 && process.env.SEED_DEMO_RESET !== '1') {
    console.log(
      `Base non vide (${companyCount} entreprise(s)). Relance avec SEED_DEMO_RESET=1 pour écraser UNIQUEMENT cette base locale.`,
    );
    process.exit(0);
  }

  if (process.env.SEED_DEMO_RESET === '1' || companyCount > 0) {
    await wipeLocalDemoData();
  }

  await ensureRoles();
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const cashierHash = await bcrypt.hash('caissier123', 10);
  const accountantHash = await bcrypt.hash('compta123', 10);

  const company = await prisma.company.create({
    data: {
      name: 'Eau Cascade',
      legalName: 'Eau Cascade S.A. (Démo locale)',
      address: 'Route de l’Aéroport, Tabarre',
      city: 'Port-au-Prince',
      country: 'Haïti',
      phone: '+50928112233',
      email: 'demo@eau-cascade.local',
      taxId: DEMO_TAX_ID,
      headerText: 'Eau Cascade\nEau conditionnée — sachets et gallons',
      currency: 'HTG',
      vatRatePercent: 0,
    },
  });

  const dept = await prisma.department.create({
    data: {
      companyId: company.id,
      name: 'Eau conditionnée',
      description: 'Production et vente gallons + paquets de sachets',
    },
  });

  await prisma.departmentPrinterProfile.create({
    data: {
      departmentId: dept.id,
      receiptHeaderText: 'Eau Cascade\nMerci de votre achat',
      receiptFooterText: 'Bonne hydratation — à bientôt',
      disbursementHeaderText: 'Ordre de décaissement — Eau Cascade',
    },
  });

  const store = await prisma.store.create({
    data: {
      companyId: company.id,
      name: 'Dépôt Tabarre',
      address: 'Tabarre 27, Port-au-Prince',
    },
  });

  const register = await prisma.register.create({
    data: {
      code: 'CAISSE-DEMO-1',
      storeId: store.id,
      departmentId: dept.id,
    },
  });

  const admin = await prisma.user.create({
    data: {
      phone: ADMIN_PHONE,
      email: 'admin@demo.local',
      password: passwordHash,
      role: 'ADMIN',
      fullName: 'Admin Démo',
      companyId: company.id,
      departmentId: dept.id,
      isActive: true,
    },
  });

  const cashier = await prisma.user.create({
    data: {
      phone: CASHIER_PHONE,
      email: 'caissier@demo.local',
      password: cashierHash,
      role: 'CASHIER',
      fullName: 'Marie Caissière',
      companyId: company.id,
      departmentId: dept.id,
      isActive: true,
    },
  });

  const accountant = await prisma.user.create({
    data: {
      phone: ACCOUNTANT_PHONE,
      email: 'comptable@demo.local',
      password: accountantHash,
      role: 'ACCOUNTANT',
      fullName: 'Jean Comptable',
      companyId: company.id,
      departmentId: dept.id,
      isActive: true,
    },
  });

  const unitGallon = await prisma.packagingUnit.create({
    data: { departmentId: dept.id, code: 'GAL', label: 'Gallon', sortOrder: 1 },
  });
  const unitPaquet = await prisma.packagingUnit.create({
    data: { departmentId: dept.id, code: 'PQT', label: 'Paquet', sortOrder: 2 },
  });

  const GALLON_PRICE = 50;
  const GALLON_COST = 18;
  const PACK_COST = 70;
  function packUnitPrice(qty: number): number {
    if (qty >= 21) return 125;
    if (qty >= 6) return 135;
    return 150;
  }

  const pGallon = await prisma.product.create({
    data: {
      companyId: company.id,
      departmentId: dept.id,
      name: 'Gallon d’eau',
      sku: 'EAU-GAL',
      description: 'Gallon d’eau potable — 50 gourdes',
      cost: GALLON_COST,
      stock: 900,
      stockMin: 80,
      trackStock: true,
      createdById: admin.id,
      saleUnits: {
        create: {
          packagingUnitId: unitGallon.id,
          salePrice: GALLON_PRICE,
          isDefault: true,
          unitsPerPackage: 1,
        },
      },
    },
    include: { saleUnits: true },
  });

  const pPack = await prisma.product.create({
    data: {
      companyId: company.id,
      departmentId: dept.id,
      name: 'Paquet de sachets d’eau',
      sku: 'EAU-PQT',
      description: 'Paquet de sachets — 1–5 : 150 G, 6–20 : 135 G, 21+ : 125 G',
      cost: PACK_COST,
      stock: 500,
      stockMin: 40,
      trackStock: true,
      createdById: admin.id,
      saleUnits: {
        create: {
          packagingUnitId: unitPaquet.id,
          salePrice: 150,
          isDefault: true,
          unitsPerPackage: 1,
          volumePrices: {
            create: [
              { minQuantity: 6, unitPrice: 135, sortOrder: 1 },
              { minQuantity: 21, unitPrice: 125, sortOrder: 2 },
            ],
          },
        },
      },
    },
    include: { saleUnits: true },
  });
  const psuGallon = pGallon.saleUnits[0]!;
  const psuPack = pPack.saleUnits[0]!;

  const bank = await prisma.bank.create({
    data: {
      companyId: company.id,
      name: 'Sogebank DEMO',
      note: 'Compte courant Eau Cascade (démo locale)',
      accounts: {
        create: {
          companyId: company.id,
          name: 'Compte courant HTG',
          accountNumber: '001-CASCADE-4421',
          openingBalance: 85000,
        },
      },
    },
    include: { accounts: true },
  });
  const bankAccount = bank.accounts[0]!;

  const clientCredit = await prisma.creditCustomer.create({
    data: {
      companyId: company.id,
      departmentId: dept.id,
      name: 'Hôtel Kaliko DEMO',
      phone: '+50931112222',
      address: 'Côte des Arcadins',
      creditLimit: 50000,
      isActive: true,
    },
  });

  const expenseCat = await prisma.expenseCategory.create({
    data: { companyId: company.id, name: 'Dépenses manuelles' },
  });
  const salesCat = await prisma.expenseCategory.create({
    data: { companyId: company.id, name: 'Ventes POS' },
  });

  // ——— Achat + réception ———
  const po = await prisma.purchaseOrder.create({
    data: {
      companyId: company.id,
      departmentId: dept.id,
      supplierName: 'Fournitures emballage DEMO',
      status: PurchaseOrderStatus.CLOSED,
      reference: 'PO-EAU-001',
      createdById: admin.id,
      lines: {
        create: [
          { productId: pGallon.id, quantityOrdered: 400, unitPriceEst: GALLON_COST },
          { productId: pPack.id, quantityOrdered: 200, unitPriceEst: PACK_COST },
        ],
      },
    },
  });

  const gr = await prisma.goodsReceipt.create({
    data: {
      purchaseOrderId: po.id,
      departmentId: dept.id,
      status: GoodsReceiptStatus.POSTED,
      receivedAt: daysAgo(20),
      createdById: admin.id,
      note: 'Réception production / emballage',
      lines: {
        create: [
          { productId: pGallon.id, quantity: 400, unitCost: GALLON_COST },
          { productId: pPack.id, quantity: 200, unitCost: PACK_COST },
        ],
      },
    },
  });

  await prisma.stockMovement.createMany({
    data: [
      {
        productId: pGallon.id,
        quantity: 400,
        type: MovementType.IN,
        reason: `Réception achat #${gr.id}`,
        createdById: admin.id,
        goodsReceiptId: gr.id,
        createdAt: daysAgo(20),
      },
      {
        productId: pPack.id,
        quantity: 200,
        type: MovementType.IN,
        reason: `Réception achat #${gr.id}`,
        createdById: admin.id,
        goodsReceiptId: gr.id,
        createdAt: daysAgo(20),
      },
    ],
  });

  // ——— Ventes caisse ———
  async function createCashSale(opts: {
    days: number;
    items: Array<{ productId: number; psuId: number; qty: number; unitPrice: number; cost: number }>;
    method?: PaymentMethod;
    bankAccountId?: number;
    delivered?: boolean;
  }) {
    const total = opts.items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
    const createdAt = daysAgo(opts.days);
    const method = opts.method ?? PaymentMethod.CASH;
    const ident = {
      uuid: crypto.randomUUID(),
    };
    const sale = await prisma.sale.create({
      data: {
        uuid: ident.uuid,
        total,
        subtotal: total,
        tax: 0,
        status: 'COMPLETED',
        cashier: cashier.fullName,
        amountPaid: total,
        amountReceived: method === PaymentMethod.CASH ? total : 0,
        changeDue: 0,
        userId: cashier.id,
        storeId: store.id,
        registerId: register.id,
        createdAt,
        items: {
          create: opts.items.map((it) => ({
            productId: it.productId,
            productSaleUnitId: it.psuId,
            quantity: it.qty,
            baseQuantity: it.qty,
            unitPrice: it.unitPrice,
            subtotal: it.qty * it.unitPrice,
            createdAt,
          })),
        },
        payments: {
          create: {
            amount: total,
            method,
            bankAccountId: method === PaymentMethod.BANK ? opts.bankAccountId : null,
            createdAt,
          },
        },
      },
      include: { items: true },
    });
    await prisma.sale.update({
      where: { id: sale.id },
      data: { txnNumber: sale.id },
    });

    await prisma.financeEntry.create({
      data: {
        type: FinanceType.INCOME,
        amount: total,
        description: `Encaissement vente #${sale.id}`,
        userId: cashier.id,
        categoryId: salesCat.id,
        saleId: sale.id,
        createdAt,
      },
    });

    const delivery = await prisma.delivery.create({
      data: {
        saleId: sale.id,
        companyId: company.id,
        departmentId: dept.id,
        status: opts.delivered === false ? 'PENDING' : 'DELIVERED',
        deliveredAt: opts.delivered === false ? null : createdAt,
        deliveredById: opts.delivered === false ? null : cashier.id,
        createdAt,
        items: {
          create: sale.items.map((si) => ({
            saleItemId: si.id,
            quantityOrdered: Number(si.quantity),
            quantityDelivered: opts.delivered === false ? 0 : Number(si.quantity),
          })),
        },
      },
    });

    if (opts.delivered !== false) {
      for (const it of opts.items) {
        await prisma.product.update({
          where: { id: it.productId },
          data: { stock: { decrement: it.qty } },
        });
        await prisma.stockMovement.create({
          data: {
            productId: it.productId,
            quantity: it.qty,
            type: MovementType.OUT,
            reason: `Livraison vente #${sale.id}`,
            createdById: cashier.id,
            createdAt,
          },
        });
      }
    }

    if (method === PaymentMethod.BANK && opts.bankAccountId) {
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: opts.bankAccountId,
          type: 'DEPOSIT',
          amount: total,
          description: `Vente #${sale.id}`,
          reference: `saleTxn:${sale.id}`,
          occurredAt: createdAt,
          userId: cashier.id,
        },
      });
    }

    return { sale, delivery };
  }

  await createCashSale({
    days: 12,
    items: [
      {
        productId: pGallon.id,
        psuId: psuGallon.id,
        qty: 24,
        unitPrice: GALLON_PRICE,
        cost: GALLON_COST,
      },
    ],
  });

  await createCashSale({
    days: 8,
    items: [
      {
        productId: pPack.id,
        psuId: psuPack.id,
        qty: 25,
        unitPrice: packUnitPrice(25),
        cost: PACK_COST,
      },
    ],
  });

  const saleMix = await createCashSale({
    days: 5,
    items: [
      {
        productId: pGallon.id,
        psuId: psuGallon.id,
        qty: 10,
        unitPrice: GALLON_PRICE,
        cost: GALLON_COST,
      },
      {
        productId: pPack.id,
        psuId: psuPack.id,
        qty: 4,
        unitPrice: packUnitPrice(4),
        cost: PACK_COST,
      },
    ],
  });

  await createCashSale({
    days: 3,
    items: [
      {
        productId: pPack.id,
        psuId: psuPack.id,
        qty: 12,
        unitPrice: packUnitPrice(12),
        cost: PACK_COST,
      },
    ],
    method: PaymentMethod.BANK,
    bankAccountId: bankAccount.id,
  });

  await createCashSale({
    days: 2,
    items: [
      {
        productId: pGallon.id,
        psuId: psuGallon.id,
        qty: 18,
        unitPrice: GALLON_PRICE,
        cost: GALLON_COST,
      },
      {
        productId: pPack.id,
        psuId: psuPack.id,
        qty: 8,
        unitPrice: packUnitPrice(8),
        cost: PACK_COST,
      },
    ],
  });

  await createCashSale({
    days: 1,
    items: [
      {
        productId: pGallon.id,
        psuId: psuGallon.id,
        qty: 6,
        unitPrice: GALLON_PRICE,
        cost: GALLON_COST,
      },
    ],
    delivered: false,
  });

  await createCashSale({
    days: 0,
    items: [
      {
        productId: pPack.id,
        psuId: psuPack.id,
        qty: 3,
        unitPrice: packUnitPrice(3),
        cost: PACK_COST,
      },
      {
        productId: pGallon.id,
        psuId: psuGallon.id,
        qty: 8,
        unitPrice: GALLON_PRICE,
        cost: GALLON_COST,
      },
    ],
  });

  // ——— Vente crédit + acompte + remboursement ———
  const creditQtyGallons = 40;
  const creditTotal = GALLON_PRICE * creditQtyGallons;
  const down = 800;
  const creditCreated = daysAgo(10);
  const creditSale = await prisma.sale.create({
    data: {
      uuid: crypto.randomUUID(),
      total: creditTotal,
      subtotal: creditTotal,
      tax: 0,
      status: 'COMPLETED',
      cashier: cashier.fullName,
      creditCustomerId: clientCredit.id,
      amountPaid: down,
      amountReceived: 0,
      changeDue: 0,
      userId: cashier.id,
      storeId: store.id,
      registerId: register.id,
      createdAt: creditCreated,
      items: {
        create: [
          {
            productId: pGallon.id,
            productSaleUnitId: psuGallon.id,
            quantity: creditQtyGallons,
            baseQuantity: creditQtyGallons,
            unitPrice: GALLON_PRICE,
            subtotal: creditTotal,
            createdAt: creditCreated,
          },
        ],
      },
      payments: {
        create: {
          amount: creditTotal,
          method: PaymentMethod.CREDIT,
          reference: 'Vente à crédit',
          createdAt: creditCreated,
        },
      },
    },
    include: { items: true },
  });
  await prisma.sale.update({
    where: { id: creditSale.id },
    data: { txnNumber: creditSale.id },
  });

  const feDown = await prisma.financeEntry.create({
    data: {
      type: FinanceType.INCOME,
      amount: down,
      description: `Acompte crédit — ${clientCredit.name} — vente #${creditSale.id}`,
      userId: cashier.id,
      categoryId: salesCat.id,
      createdAt: creditCreated,
    },
  });
  await prisma.creditPayment.create({
    data: {
      creditCustomerId: clientCredit.id,
      saleId: creditSale.id,
      amount: down,
      method: PaymentMethod.CASH,
      note: 'Acompte à l’achat',
      userId: cashier.id,
      financeEntryId: feDown.id,
      createdAt: creditCreated,
    },
  });

  await prisma.delivery.create({
    data: {
      saleId: creditSale.id,
      companyId: company.id,
      departmentId: dept.id,
      status: 'DELIVERED',
      deliveredAt: creditCreated,
      deliveredById: cashier.id,
      createdAt: creditCreated,
      items: {
        create: creditSale.items.map((si) => ({
          saleItemId: si.id,
          quantityOrdered: Number(si.quantity),
          quantityDelivered: Number(si.quantity),
        })),
      },
    },
  });
  await prisma.product.update({
    where: { id: pGallon.id },
    data: { stock: { decrement: creditQtyGallons } },
  });

  const repayAt = daysAgo(2);
  const repayAmount = 700;
  const feRepay = await prisma.financeEntry.create({
    data: {
      type: FinanceType.INCOME,
      amount: repayAmount,
      description: `Remboursement crédit — ${clientCredit.name}`,
      userId: cashier.id,
      categoryId: salesCat.id,
      createdAt: repayAt,
    },
  });
  await prisma.creditPayment.create({
    data: {
      creditCustomerId: clientCredit.id,
      saleId: creditSale.id,
      amount: repayAmount,
      method: PaymentMethod.BANK,
      bankAccountId: bankAccount.id,
      userId: cashier.id,
      financeEntryId: feRepay.id,
      createdAt: repayAt,
    },
  });
  await prisma.sale.update({
    where: { id: creditSale.id },
    data: { amountPaid: down + repayAmount },
  });
  await prisma.bankTransaction.create({
    data: {
      bankAccountId: bankAccount.id,
      type: 'DEPOSIT',
      amount: repayAmount,
      description: `Remboursement crédit — ${clientCredit.name}`,
      reference: `creditPayment:demo`,
      occurredAt: repayAt,
      userId: cashier.id,
    },
  });

  // ——— Dépenses ———
  for (const [label, amount, d] of [
    ['LOYER DEPOT', 18000, 15],
    ['SALAIRE', 22000, 7],
    ['CARBURANT LIVRAISON', 6500, 4],
    ['SACHETS VIDES', 4200, 2],
  ] as const) {
    await prisma.financeEntry.create({
      data: {
        type: FinanceType.EXPENSE,
        amount,
        description: label,
        detail: `Dépense démo ${label}`,
        categoryId: expenseCat.id,
        userId: admin.id,
        createdAt: daysAgo(d),
      },
    });
  }

  // ——— Banque manuelle ———
  await prisma.bankTransaction.create({
    data: {
      bankAccountId: bankAccount.id,
      type: 'DEPOSIT',
      amount: 10000,
      description: 'Dépôt caisse → banque (démo)',
      reference: 'MANUAL-DEMO-1',
      occurredAt: daysAgo(6),
      userId: admin.id,
    },
  });

  // ——— Plan comptable + exercice + écritures de base ———
  await prisma.account.createMany({
    data: DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({
      companyId: company.id,
      code: a.code,
      name: a.name,
      classNumber: a.classNumber,
      nature: a.nature,
      isDebitNormal: a.isDebitNormal,
      systemKey: a.systemKey ?? null,
      isSystem: Boolean(a.systemKey),
    })),
  });

  const year = new Date().getFullYear();
  const fy = await prisma.fiscalYear.create({
    data: {
      companyId: company.id,
      label: String(year),
      startDate: utcDate(year, 1, 1),
      endDate: utcDate(year, 12, 31),
      status: 'OPEN',
    },
  });

  // Immobilisation démo
  const asset = await prisma.fixedAsset.create({
    data: {
      companyId: company.id,
      name: 'Ligne de remplissage gallons DEMO',
      acquisitionDate: utcDate(year, 1, 15),
      acquisitionCost: 120000,
      residualValue: 8000,
      usefulLifeMonths: 84,
      createdById: admin.id,
    },
  });

  const accByKey = async (key: string) => {
    const a = await prisma.account.findFirst({
      where: { companyId: company.id, systemKey: key },
    });
    if (!a) throw new Error(`Compte système ${key} manquant`);
    return a;
  };
  const accByCode = async (code: string) => {
    const a = await prisma.account.findFirst({
      where: { companyId: company.id, code },
    });
    if (!a) throw new Error(`Compte ${code} manquant`);
    return a;
  };

  const cash = await accByKey('CASH');
  const bankAcc = await accByKey('BANK');
  const sales = await accByKey('SALES');
  const customers = await accByKey('CUSTOMERS');
  const suppliers = await accByKey('SUPPLIERS');
  const inventory = await accByKey('INVENTORY');
  const fixed = await accByKey('FIXED_ASSETS');
  const rent = await accByCode('613');
  const salary = await accByCode('641');

  let entryNumber = 0;
  async function post(
    source: string,
    sourceId: string,
    description: string,
    entryDate: Date,
    journalCode: JournalCode,
    lines: Array<{ accountId: number; debit?: number; credit?: number; label?: string }>,
  ) {
    entryNumber += 1;
    await prisma.journalEntry.create({
      data: {
        companyId: company.id,
        fiscalYearId: fy.id,
        entryDate,
        journalCode,
        entryNumber,
        description,
        source,
        sourceId,
        status: JournalEntryStatus.POSTED,
        createdById: admin.id,
        lines: {
          create: lines.map((l, i) => ({
            accountId: l.accountId,
            debit: l.debit ?? 0,
            credit: l.credit ?? 0,
            label: l.label ?? null,
            sortOrder: i,
          })),
        },
      },
    });
  }

  // Échantillon d’écritures pour bilans immédiatement visibles
  await post(
    'FIXED_ASSET',
    String(asset.id),
    'Acquisition immobilisation — Ligne de remplissage gallons DEMO',
    utcDate(year, 1, 15),
    JournalCode.OD,
    [
      { accountId: fixed.id, debit: 120000 },
      { accountId: bankAcc.id, credit: 120000 },
    ],
  );
  const purchaseAmount = 400 * GALLON_COST + 200 * PACK_COST;
  await post(
    'PURCHASE',
    String(gr.id),
    'Achat stock — Fournitures emballage DEMO',
    daysAgo(20),
    JournalCode.AC,
    [
      { accountId: inventory.id, debit: purchaseAmount },
      { accountId: suppliers.id, credit: purchaseAmount },
    ],
  );
  await post(
    'SUPPLIER_PAYMENT',
    'demo-1',
    'Paiement fournisseur — Fournitures emballage DEMO',
    daysAgo(18),
    JournalCode.BQ,
    [
      { accountId: suppliers.id, debit: 15000 },
      { accountId: bankAcc.id, credit: 15000 },
    ],
  );
  await prisma.supplierPayment.create({
    data: {
      companyId: company.id,
      supplierName: 'Fournitures emballage DEMO',
      amount: 15000,
      method: PaymentMethod.BANK,
      bankAccountId: bankAccount.id,
      paidAt: daysAgo(18),
      userId: admin.id,
      note: 'Acompte fournisseur démo',
    },
  });

  const mixTotal = Number(saleMix.sale.total);
  await post(
    'SALE',
    String(saleMix.sale.id),
    'Vente POS — gallons et paquets',
    daysAgo(5),
    JournalCode.CA,
    [
      { accountId: cash.id, debit: mixTotal },
      { accountId: sales.id, credit: mixTotal },
    ],
  );
  await post(
    'CREDIT_SALE',
    String(creditSale.id),
    'Vente à crédit — Hôtel Kaliko DEMO',
    creditCreated,
    JournalCode.VE,
    [
      { accountId: customers.id, debit: creditTotal },
      { accountId: sales.id, credit: creditTotal },
    ],
  );
  await post(
    'CREDIT_PAYMENT',
    'demo-repay',
    'Encaissement créance client',
    repayAt,
    JournalCode.BQ,
    [
      { accountId: bankAcc.id, debit: repayAmount },
      { accountId: customers.id, credit: repayAmount },
    ],
  );
  await post(
    'EXPENSE',
    'demo-loyer',
    'Dépense — LOYER DEPOT',
    daysAgo(15),
    JournalCode.CA,
    [
      { accountId: rent.id, debit: 18000 },
      { accountId: cash.id, credit: 18000 },
    ],
  );
  await post(
    'EXPENSE',
    'demo-salaire',
    'Dépense — SALAIRE',
    daysAgo(7),
    JournalCode.CA,
    [
      { accountId: salary.id, debit: 22000 },
      { accountId: cash.id, credit: 22000 },
    ],
  );

  console.log('\n========== SEED DÉMO LOCAL TERMINÉ ==========');
  console.log('Machine : Docker pos_eau_cascade_postgres @ 127.0.0.1:5434');
  console.log('Aucune synchro cloud — données fictives locales uniquement.');
  console.log('');
  console.log('Entreprise :', company.name, `| NIF: ${DEMO_TAX_ID}`);
  console.log('Produits : Gallon 50 G | Paquet sachets 1–5=150, 6–20=135, 21+=125');
  console.log('Exercice comptable ouvert :', fy.label, '(1 janv. → 31 déc.)');
  console.log('');
  console.log('Connexions :');
  console.log(`  Admin      ${ADMIN_PHONE} / ${ADMIN_PASSWORD}`);
  console.log(`  Caissier   ${CASHIER_PHONE} / caissier123`);
  console.log(`  Comptable  ${ACCOUNTANT_PHONE} / compta123`);
  console.log('');
  console.log('À tester : Caisse, Crédit, Stocks/Achats, Livraisons, Comptabilité (bilan, journal, reprise).');
  console.log('=============================================\n');
}

main()
  .catch((error) => {
    console.error('Seed démo échoué:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
