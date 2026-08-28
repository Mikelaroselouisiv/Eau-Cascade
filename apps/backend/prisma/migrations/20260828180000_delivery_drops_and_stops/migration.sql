-- Adresses de dépôt (vente à domicile) + lignes d'exécution de livraison.

CREATE TABLE "SaleDeliveryStop" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "saleId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleDeliveryStop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleDeliveryStop_uuid_key" ON "SaleDeliveryStop"("uuid");
CREATE INDEX "SaleDeliveryStop_saleId_idx" ON "SaleDeliveryStop"("saleId");

ALTER TABLE "SaleDeliveryStop" ADD CONSTRAINT "SaleDeliveryStop_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeliveryDrop" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "deliveryId" INTEGER NOT NULL,
    "saleItemId" INTEGER NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "executorName" TEXT,
    "deliveredById" INTEGER,
    "stopId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryDrop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryDrop_uuid_key" ON "DeliveryDrop"("uuid");
CREATE INDEX "DeliveryDrop_deliveryId_createdAt_idx" ON "DeliveryDrop"("deliveryId", "createdAt");
CREATE INDEX "DeliveryDrop_saleItemId_idx" ON "DeliveryDrop"("saleItemId");
CREATE INDEX "DeliveryDrop_departmentId_idx" ON "DeliveryDrop"("departmentId");
CREATE INDEX "DeliveryDrop_stopId_idx" ON "DeliveryDrop"("stopId");

ALTER TABLE "DeliveryDrop" ADD CONSTRAINT "DeliveryDrop_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryDrop" ADD CONSTRAINT "DeliveryDrop_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryDrop" ADD CONSTRAINT "DeliveryDrop_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryDrop" ADD CONSTRAINT "DeliveryDrop_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryDrop" ADD CONSTRAINT "DeliveryDrop_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "SaleDeliveryStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryDrop" ADD CONSTRAINT "DeliveryDrop_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill : une adresse à partir de la vente HOME existante.
INSERT INTO "SaleDeliveryStop" ("uuid", "saleId", "address", "quantity", "sortOrder", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    s."id",
    s."clientAddress",
    COALESCE((
        SELECT SUM(si."quantity") FROM "SaleItem" si
        WHERE si."saleId" = s."id" AND si."deletedAt" IS NULL
    ), 0),
    0,
    NOW(),
    NOW()
FROM "Sale" s
WHERE s."fulfillmentType" = 'HOME'
  AND s."deletedAt" IS NULL
  AND s."clientAddress" IS NOT NULL
  AND TRIM(s."clientAddress") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "SaleDeliveryStop" st WHERE st."saleId" = s."id"
  );

-- Backfill : une ligne d'exécution pour les quantités déjà livrées.
INSERT INTO "DeliveryDrop" ("uuid", "deliveryId", "saleItemId", "quantity", "departmentId", "executorName", "deliveredById", "stopId", "createdById", "createdAt")
SELECT
    gen_random_uuid()::text,
    di."deliveryId",
    di."saleItemId",
    di."quantityDelivered",
    COALESCE(d."departmentId", (
        SELECT p."departmentId" FROM "SaleItem" si
        JOIN "Product" p ON p."id" = si."productId"
        WHERE si."id" = di."saleItemId"
        LIMIT 1
    )),
    d."executorName",
    d."deliveredById",
    (
        SELECT st."id" FROM "SaleDeliveryStop" st
        WHERE st."saleId" = d."saleId"
        ORDER BY st."sortOrder" ASC, st."id" ASC
        LIMIT 1
    ),
    d."deliveredById",
    COALESCE(d."deliveredAt", d."updatedAt", d."createdAt")
FROM "DeliveryItem" di
JOIN "Delivery" d ON d."id" = di."deliveryId"
WHERE di."quantityDelivered" > 0
  AND COALESCE(d."departmentId", (
        SELECT p."departmentId" FROM "SaleItem" si
        JOIN "Product" p ON p."id" = si."productId"
        WHERE si."id" = di."saleItemId"
        LIMIT 1
  )) IS NOT NULL;
