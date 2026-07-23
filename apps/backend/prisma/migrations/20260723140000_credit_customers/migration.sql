-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CREDIT';

-- AlterTable Sale
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "creditCustomerId" INTEGER;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable CreditCustomer
CREATE TABLE IF NOT EXISTS "CreditCustomer" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "departmentId" INTEGER,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "note" TEXT,
    "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CreditCustomer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreditCustomer_uuid_key" ON "CreditCustomer"("uuid");
CREATE INDEX IF NOT EXISTS "CreditCustomer_companyId_isActive_idx" ON "CreditCustomer"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "CreditCustomer_companyId_name_idx" ON "CreditCustomer"("companyId", "name");

-- CreateTable CreditPayment
CREATE TABLE IF NOT EXISTS "CreditPayment" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "creditCustomerId" INTEGER NOT NULL,
    "saleId" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "note" TEXT,
    "userId" INTEGER,
    "financeEntryId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CreditPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreditPayment_uuid_key" ON "CreditPayment"("uuid");
CREATE UNIQUE INDEX IF NOT EXISTS "CreditPayment_financeEntryId_key" ON "CreditPayment"("financeEntryId");
CREATE INDEX IF NOT EXISTS "CreditPayment_creditCustomerId_createdAt_idx" ON "CreditPayment"("creditCustomerId", "createdAt");
CREATE INDEX IF NOT EXISTS "CreditPayment_saleId_createdAt_idx" ON "CreditPayment"("saleId", "createdAt");

-- FKs (ignore if already present)
DO $$ BEGIN
  ALTER TABLE "CreditCustomer" ADD CONSTRAINT "CreditCustomer_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CreditCustomer" ADD CONSTRAINT "CreditCustomer_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Sale" ADD CONSTRAINT "Sale_creditCustomerId_fkey"
    FOREIGN KEY ("creditCustomerId") REFERENCES "CreditCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_creditCustomerId_fkey"
    FOREIGN KEY ("creditCustomerId") REFERENCES "CreditCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_financeEntryId_fkey"
    FOREIGN KEY ("financeEntryId") REFERENCES "FinanceEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Sale_creditCustomerId_createdAt_idx" ON "Sale"("creditCustomerId", "createdAt");
