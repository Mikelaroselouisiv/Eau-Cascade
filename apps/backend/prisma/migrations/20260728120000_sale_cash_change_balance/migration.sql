-- Espèces tendues / monnaie à rendre / suivi règlement POS classique
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "amountReceived" DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "changeDue" DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "changeSettledAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "cashBalanceSettledAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Sale_changeDue_status_idx" ON "Sale"("changeDue", "status");
CREATE INDEX IF NOT EXISTS "Sale_amountPaid_status_idx" ON "Sale"("amountPaid", "status");
