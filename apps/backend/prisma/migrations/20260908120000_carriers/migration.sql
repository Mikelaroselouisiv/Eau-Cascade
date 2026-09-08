CREATE TABLE IF NOT EXISTS "Carrier" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Carrier_uuid_key" ON "Carrier"("uuid");
CREATE INDEX IF NOT EXISTS "Carrier_departmentId_isActive_idx" ON "Carrier"("departmentId", "isActive");
CREATE INDEX IF NOT EXISTS "Carrier_companyId_name_idx" ON "Carrier"("companyId", "name");

CREATE TABLE IF NOT EXISTS "CarrierRate" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "carrierId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "coefficient" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarrierRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CarrierRate_uuid_key" ON "CarrierRate"("uuid");
CREATE UNIQUE INDEX IF NOT EXISTS "CarrierRate_carrierId_productId_key" ON "CarrierRate"("carrierId", "productId");
CREATE INDEX IF NOT EXISTS "CarrierRate_productId_idx" ON "CarrierRate"("productId");

CREATE TABLE IF NOT EXISTS "CarrierTrip" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "carrierId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "deliveryId" INTEGER NOT NULL,
    "deliveryDropId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "coefficient" DECIMAL(12,4) NOT NULL,
    "payrollAmount" DECIMAL(12,2) NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarrierTrip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CarrierTrip_uuid_key" ON "CarrierTrip"("uuid");
CREATE INDEX IF NOT EXISTS "CarrierTrip_carrierId_createdAt_idx" ON "CarrierTrip"("carrierId", "createdAt");
CREATE INDEX IF NOT EXISTS "CarrierTrip_departmentId_createdAt_idx" ON "CarrierTrip"("departmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "CarrierTrip_deliveryDropId_idx" ON "CarrierTrip"("deliveryDropId");
CREATE INDEX IF NOT EXISTS "CarrierTrip_productId_idx" ON "CarrierTrip"("productId");

ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "carrierId" INTEGER;
CREATE INDEX IF NOT EXISTS "Delivery_carrierId_idx" ON "Delivery"("carrierId");

ALTER TABLE "DeliveryDrop" ADD COLUMN IF NOT EXISTS "carrierId" INTEGER;
CREATE INDEX IF NOT EXISTS "DeliveryDrop_carrierId_idx" ON "DeliveryDrop"("carrierId");

DO $$ BEGIN
  ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CarrierRate" ADD CONSTRAINT "CarrierRate_carrierId_fkey"
    FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CarrierRate" ADD CONSTRAINT "CarrierRate_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CarrierTrip" ADD CONSTRAINT "CarrierTrip_carrierId_fkey"
    FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CarrierTrip" ADD CONSTRAINT "CarrierTrip_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CarrierTrip" ADD CONSTRAINT "CarrierTrip_deliveryId_fkey"
    FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CarrierTrip" ADD CONSTRAINT "CarrierTrip_deliveryDropId_fkey"
    FOREIGN KEY ("deliveryDropId") REFERENCES "DeliveryDrop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CarrierTrip" ADD CONSTRAINT "CarrierTrip_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CarrierTrip" ADD CONSTRAINT "CarrierTrip_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_carrierId_fkey"
    FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DeliveryDrop" ADD CONSTRAINT "DeliveryDrop_carrierId_fkey"
    FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
