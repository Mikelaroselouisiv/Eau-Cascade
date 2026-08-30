-- CreateEnum
CREATE TYPE "DepartmentKind" AS ENUM ('DISTRIBUTION', 'PRODUCTION_DISTRIBUTION');

-- CreateEnum
CREATE TYPE "ProductionSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "InternalTransferStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductNature" AS ENUM ('FINISHED_GOOD', 'RAW_MATERIAL');

-- CreateEnum
CREATE TYPE "ProductionFlowKind" AS ENUM ('PRODUCED', 'TRANSFER_IN', 'FLOW_CLIENT', 'FLOW_TRANSFER_OUT');

-- AlterTable
ALTER TABLE "Department" ADD COLUMN "kind" "DepartmentKind" NOT NULL DEFAULT 'DISTRIBUTION';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "nature" "ProductNature" NOT NULL DEFAULT 'FINISHED_GOOD';

-- CreateTable
CREATE TABLE "ProductionSession" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "status" "ProductionSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedDeviceId" TEXT,
    "openedDeviceName" TEXT,
    "closedById" INTEGER,
    "closedAt" TIMESTAMP(3),
    "note" TEXT,
    "openingInventorySessionId" INTEGER NOT NULL,
    "closingInventorySessionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalTransfer" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "fromDepartmentId" INTEGER NOT NULL,
    "toDepartmentId" INTEGER NOT NULL,
    "status" "InternalTransferStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdById" INTEGER,
    "confirmedById" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InternalTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalTransferItem" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "transferId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InternalTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionFlow" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "kind" "ProductionFlowKind" NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "productionSessionId" INTEGER,
    "internalTransferId" INTEGER,
    "deliveryId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionFlow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionSession_uuid_key" ON "ProductionSession"("uuid");
CREATE UNIQUE INDEX "ProductionSession_openingInventorySessionId_key" ON "ProductionSession"("openingInventorySessionId");
CREATE UNIQUE INDEX "ProductionSession_closingInventorySessionId_key" ON "ProductionSession"("closingInventorySessionId");
CREATE INDEX "ProductionSession_departmentId_status_idx" ON "ProductionSession"("departmentId", "status");

CREATE UNIQUE INDEX "InternalTransfer_uuid_key" ON "InternalTransfer"("uuid");
CREATE INDEX "InternalTransfer_toDepartmentId_status_idx" ON "InternalTransfer"("toDepartmentId", "status");
CREATE INDEX "InternalTransfer_fromDepartmentId_status_idx" ON "InternalTransfer"("fromDepartmentId", "status");
CREATE INDEX "InternalTransfer_companyId_createdAt_idx" ON "InternalTransfer"("companyId", "createdAt");

CREATE UNIQUE INDEX "InternalTransferItem_uuid_key" ON "InternalTransferItem"("uuid");
CREATE INDEX "InternalTransferItem_transferId_idx" ON "InternalTransferItem"("transferId");

CREATE UNIQUE INDEX "ProductionFlow_uuid_key" ON "ProductionFlow"("uuid");
CREATE INDEX "ProductionFlow_departmentId_kind_createdAt_idx" ON "ProductionFlow"("departmentId", "kind", "createdAt");
CREATE INDEX "ProductionFlow_productId_createdAt_idx" ON "ProductionFlow"("productId", "createdAt");

ALTER TABLE "ProductionSession" ADD CONSTRAINT "ProductionSession_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionSession" ADD CONSTRAINT "ProductionSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionSession" ADD CONSTRAINT "ProductionSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionSession" ADD CONSTRAINT "ProductionSession_openingInventorySessionId_fkey" FOREIGN KEY ("openingInventorySessionId") REFERENCES "InventorySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionSession" ADD CONSTRAINT "ProductionSession_closingInventorySessionId_fkey" FOREIGN KEY ("closingInventorySessionId") REFERENCES "InventorySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InternalTransfer" ADD CONSTRAINT "InternalTransfer_fromDepartmentId_fkey" FOREIGN KEY ("fromDepartmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalTransfer" ADD CONSTRAINT "InternalTransfer_toDepartmentId_fkey" FOREIGN KEY ("toDepartmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalTransfer" ADD CONSTRAINT "InternalTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalTransfer" ADD CONSTRAINT "InternalTransfer_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InternalTransferItem" ADD CONSTRAINT "InternalTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "InternalTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalTransferItem" ADD CONSTRAINT "InternalTransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductionFlow" ADD CONSTRAINT "ProductionFlow_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionFlow" ADD CONSTRAINT "ProductionFlow_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionFlow" ADD CONSTRAINT "ProductionFlow_productionSessionId_fkey" FOREIGN KEY ("productionSessionId") REFERENCES "ProductionSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionFlow" ADD CONSTRAINT "ProductionFlow_internalTransferId_fkey" FOREIGN KEY ("internalTransferId") REFERENCES "InternalTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionFlow" ADD CONSTRAINT "ProductionFlow_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionFlow" ADD CONSTRAINT "ProductionFlow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rôle chef de production (création idempotente)
INSERT INTO "AppRole" ("uuid", "code", "label", "description", "permissions", "isSystem", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       'CHEF_PRODUCTION',
       'Chef de production',
       'Ouvre la production et exécute les livraisons (usine)',
       ARRAY[
         'production.use',
         'transfers.manage',
         'transfers.confirm',
         'deliveries.view',
         'deliveries.manage',
         'deliveries.manage_onsite',
         'deliveries.manage_home',
         'products.view',
         'stock.view'
       ]::text[],
       TRUE,
       TRUE,
       NOW(),
       NOW()
WHERE NOT EXISTS (SELECT 1 FROM "AppRole" WHERE "code" = 'CHEF_PRODUCTION');

UPDATE "AppRole"
SET "permissions" = (
  SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['transfers.confirm']::text[]))
),
    "updatedAt" = NOW()
WHERE "deletedAt" IS NULL
  AND "code" IN ('CASHIER', 'STOCK_MANAGER', 'CAISSIER_CENTRAL')
  AND NOT ('transfers.confirm' = ANY("permissions"));

UPDATE "AppRole"
SET "permissions" = (
  SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['production.use','transfers.manage','transfers.confirm']::text[]))
),
    "updatedAt" = NOW()
WHERE "deletedAt" IS NULL
  AND "code" IN ('MANAGER')
  AND NOT ('production.use' = ANY("permissions"));
