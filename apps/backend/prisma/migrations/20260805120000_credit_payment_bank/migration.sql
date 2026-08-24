-- Encaissement crédit par compte bancaire (comme POS).
ALTER TABLE "CreditPayment" ADD COLUMN IF NOT EXISTS "bankAccountId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CreditPayment_bankAccountId_fkey'
  ) THEN
    ALTER TABLE "CreditPayment"
      ADD CONSTRAINT "CreditPayment_bankAccountId_fkey"
      FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CreditPayment_bankAccountId_idx" ON "CreditPayment"("bankAccountId");
