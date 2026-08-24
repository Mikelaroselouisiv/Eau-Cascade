-- Paiement banque (POS) : dépôt sur compte, hors caisse.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BANK';

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "bankAccountId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_bankAccountId_fkey'
  ) THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_bankAccountId_fkey"
      FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Payment_bankAccountId_idx" ON "Payment"("bankAccountId");
