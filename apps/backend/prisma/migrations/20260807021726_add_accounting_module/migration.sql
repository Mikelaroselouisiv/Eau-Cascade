/*
  Warnings:

  - Made the column `phone` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "AccountNature" AS ENUM ('BALANCE_SHEET', 'INCOME_STATEMENT');

-- CreateEnum
CREATE TYPE "JournalCode" AS ENUM ('VE', 'AC', 'BQ', 'CA', 'OD', 'AN');

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "AppRole" ALTER COLUMN "permissions" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "uuid" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Bank" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BankAccount" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BankTransaction" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CashClosure" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Company" ALTER COLUMN "uuid" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CreditCustomer" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CreditPayment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DepartmentPrinterProfile" ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "uuid" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExpenseCategory" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FinanceEntry" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GoodsReceipt" ALTER COLUMN "uuid" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GoodsReceiptLine" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InventoryLine" ALTER COLUMN "uuid" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InventorySession" ALTER COLUMN "uuid" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PackagingUnit" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductFamily" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductFamilyTier" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductRecipe" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductSaleUnit" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductVolumePrice" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ALTER COLUMN "uuid" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RecipeComponent" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Register" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Sale" ALTER COLUMN "uuid" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StockMovement" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Store" ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SyncState" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL,
ALTER COLUMN "uuid" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classNumber" INTEGER NOT NULL,
    "nature" "AccountNature" NOT NULL,
    "isDebitNormal" BOOLEAN NOT NULL DEFAULT true,
    "systemKey" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "fiscalYearId" INTEGER NOT NULL,
    "entryDate" DATE NOT NULL,
    "journalCode" "JournalCode" NOT NULL DEFAULT 'OD',
    "entryNumber" INTEGER NOT NULL,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "journalEntryId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "label" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_uuid_key" ON "Account"("uuid");

-- CreateIndex
CREATE INDEX "Account_companyId_classNumber_isActive_idx" ON "Account"("companyId", "classNumber", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_code_key" ON "Account"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_systemKey_key" ON "Account"("companyId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_uuid_key" ON "FiscalYear"("uuid");

-- CreateIndex
CREATE INDEX "FiscalYear_companyId_status_idx" ON "FiscalYear"("companyId", "status");

-- CreateIndex
CREATE INDEX "FiscalYear_companyId_startDate_endDate_idx" ON "FiscalYear"("companyId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_companyId_label_key" ON "FiscalYear"("companyId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_uuid_key" ON "JournalEntry"("uuid");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_entryDate_idx" ON "JournalEntry"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_fiscalYearId_entryDate_idx" ON "JournalEntry"("fiscalYearId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_status_entryDate_idx" ON "JournalEntry"("companyId", "status", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_fiscalYearId_journalCode_entryNumber_key" ON "JournalEntry"("fiscalYearId", "journalCode", "entryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_companyId_source_sourceId_key" ON "JournalEntry"("companyId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLine_uuid_key" ON "JournalLine"("uuid");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "JournalLine_journalEntryId_sortOrder_idx" ON "JournalLine"("journalEntryId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
