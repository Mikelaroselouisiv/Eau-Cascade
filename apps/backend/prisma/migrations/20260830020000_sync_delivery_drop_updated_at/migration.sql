-- DeliveryDrop / ProductionFlow : curseur sync /sync/pull (updatedAt).
-- Sans cette colonne, le pull 500 et coupe le cycle (livraisons + sessions).

ALTER TABLE "DeliveryDrop" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ProductionFlow" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
