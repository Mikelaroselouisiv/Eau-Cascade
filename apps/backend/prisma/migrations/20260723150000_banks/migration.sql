-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BankTransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable Bank
CREATE TABLE IF NOT EXISTS "Bank" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Bank_uuid_key" ON "Bank"("uuid");
CREATE INDEX IF NOT EXISTS "Bank_companyId_isActive_idx" ON "Bank"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "Bank_companyId_name_idx" ON "Bank"("companyId", "name");

-- CreateTable BankAccount
CREATE TABLE IF NOT EXISTS "BankAccount" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "bankId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT,
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BankAccount_uuid_key" ON "BankAccount"("uuid");
CREATE INDEX IF NOT EXISTS "BankAccount_companyId_isActive_idx" ON "BankAccount"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "BankAccount_bankId_isActive_idx" ON "BankAccount"("bankId", "isActive");

-- CreateTable BankTransaction
CREATE TABLE IF NOT EXISTS "BankTransaction" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "bankAccountId" INTEGER NOT NULL,
    "type" "BankTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BankTransaction_uuid_key" ON "BankTransaction"("uuid");
CREATE INDEX IF NOT EXISTS "BankTransaction_bankAccountId_occurredAt_idx" ON "BankTransaction"("bankAccountId", "occurredAt");
CREATE INDEX IF NOT EXISTS "BankTransaction_occurredAt_idx" ON "BankTransaction"("occurredAt");

DO $$ BEGIN
  ALTER TABLE "Bank" ADD CONSTRAINT "Bank_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_bankId_fkey"
    FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
