-- AlterEnum
ALTER TYPE "ProductionFlowKind" ADD VALUE IF NOT EXISTS 'FLOW_DONATION';

-- CreateTable DonationBeneficiary
CREATE TABLE IF NOT EXISTS "DonationBeneficiary" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "departmentId" INTEGER,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DonationBeneficiary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DonationBeneficiary_uuid_key" ON "DonationBeneficiary"("uuid");
CREATE INDEX IF NOT EXISTS "DonationBeneficiary_companyId_isActive_idx" ON "DonationBeneficiary"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "DonationBeneficiary_companyId_name_idx" ON "DonationBeneficiary"("companyId", "name");

-- CreateTable Donation
CREATE TABLE IF NOT EXISTS "Donation" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "beneficiaryId" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Donation_uuid_key" ON "Donation"("uuid");
CREATE INDEX IF NOT EXISTS "Donation_companyId_createdAt_idx" ON "Donation"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "Donation_beneficiaryId_createdAt_idx" ON "Donation"("beneficiaryId", "createdAt");
CREATE INDEX IF NOT EXISTS "Donation_departmentId_createdAt_idx" ON "Donation"("departmentId", "createdAt");

-- CreateTable DonationItem
CREATE TABLE IF NOT EXISTS "DonationItem" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "donationId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DonationItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DonationItem_uuid_key" ON "DonationItem"("uuid");
CREATE INDEX IF NOT EXISTS "DonationItem_donationId_idx" ON "DonationItem"("donationId");
CREATE INDEX IF NOT EXISTS "DonationItem_productId_idx" ON "DonationItem"("productId");

ALTER TABLE "ProductionFlow" ADD COLUMN IF NOT EXISTS "donationId" INTEGER;
CREATE INDEX IF NOT EXISTS "ProductionFlow_donationId_idx" ON "ProductionFlow"("donationId");

DO $$ BEGIN
  ALTER TABLE "DonationBeneficiary" ADD CONSTRAINT "DonationBeneficiary_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DonationBeneficiary" ADD CONSTRAINT "DonationBeneficiary_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Donation" ADD CONSTRAINT "Donation_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Donation" ADD CONSTRAINT "Donation_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Donation" ADD CONSTRAINT "Donation_beneficiaryId_fkey"
    FOREIGN KEY ("beneficiaryId") REFERENCES "DonationBeneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Donation" ADD CONSTRAINT "Donation_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DonationItem" ADD CONSTRAINT "DonationItem_donationId_fkey"
    FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DonationItem" ADD CONSTRAINT "DonationItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionFlow" ADD CONSTRAINT "ProductionFlow_donationId_fkey"
    FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
