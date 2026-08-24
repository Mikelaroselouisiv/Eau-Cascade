-- Numéro de transaction métier stable (survit au sync ; Sale.id reste local).
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "txnNumber" INTEGER;

UPDATE "Sale" SET "txnNumber" = "id" WHERE "txnNumber" IS NULL;

CREATE INDEX IF NOT EXISTS "Sale_txnNumber_idx" ON "Sale"("txnNumber");
