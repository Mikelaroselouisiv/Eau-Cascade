-- Numéro de fiche imprimable stable entre nœuds (local ↔ GCP).
-- L’id autoincrement local diverge au sync ; ticketNo est un scalaire répliqué.

ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "ticketNo" TEXT;

UPDATE "Sale"
SET "ticketNo" = UPPER(SUBSTRING(REPLACE("uuid"::text, '-', ''), 1, 8))
WHERE "ticketNo" IS NULL OR TRIM("ticketNo") = '';

ALTER TABLE "Sale" ALTER COLUMN "ticketNo" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Sale_ticketNo_key" ON "Sale"("ticketNo");
