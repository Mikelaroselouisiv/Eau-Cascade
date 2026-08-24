-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductFamily" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductFamilyTier" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "productFamilyId" INTEGER NOT NULL,
    "minQuantity" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductFamilyTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductFamily_uuid_key" ON "ProductFamily"("uuid");
CREATE INDEX IF NOT EXISTS "ProductFamily_companyId_idx" ON "ProductFamily"("companyId");

CREATE UNIQUE INDEX IF NOT EXISTS "ProductFamilyTier_uuid_key" ON "ProductFamilyTier"("uuid");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductFamilyTier_productFamilyId_minQuantity_key" ON "ProductFamilyTier"("productFamilyId", "minQuantity");

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "productFamilyId" INTEGER;
CREATE INDEX IF NOT EXISTS "Product_productFamilyId_idx" ON "Product"("productFamilyId");

DO $$ BEGIN
  ALTER TABLE "ProductFamily" ADD CONSTRAINT "ProductFamily_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductFamilyTier" ADD CONSTRAINT "ProductFamilyTier_productFamilyId_fkey"
    FOREIGN KEY ("productFamilyId") REFERENCES "ProductFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_productFamilyId_fkey"
    FOREIGN KEY ("productFamilyId") REFERENCES "ProductFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
