-- Encaissement crédit rattaché à la session caisse (espèces au tiroir).
ALTER TABLE "CreditPayment" ADD COLUMN "registerSessionId" INTEGER;

ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_registerSessionId_fkey" FOREIGN KEY ("registerSessionId") REFERENCES "RegisterSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CreditPayment_registerSessionId_idx" ON "CreditPayment"("registerSessionId");

-- Caissier central : exécute aussi les livraisons (fiches créées à la caisse).
UPDATE "AppRole"
SET "permissions" = (
  SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['deliveries.manage','deliveries.manage_onsite','deliveries.manage_home']::text[]))
),
    "updatedAt" = NOW()
WHERE "deletedAt" IS NULL
  AND "code" = 'CAISSIER_CENTRAL'
  AND NOT ('deliveries.manage' = ANY("permissions"));
