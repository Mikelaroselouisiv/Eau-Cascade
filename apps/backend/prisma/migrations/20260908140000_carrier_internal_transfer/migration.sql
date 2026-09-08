ALTER TABLE "InternalTransfer" ADD COLUMN IF NOT EXISTS "carrierId" INTEGER;
CREATE INDEX IF NOT EXISTS "InternalTransfer_carrierId_idx" ON "InternalTransfer"("carrierId");

ALTER TABLE "CarrierTrip" ALTER COLUMN "deliveryId" DROP NOT NULL;
ALTER TABLE "CarrierTrip" ALTER COLUMN "deliveryDropId" DROP NOT NULL;
ALTER TABLE "CarrierTrip" ADD COLUMN IF NOT EXISTS "internalTransferId" INTEGER;
CREATE INDEX IF NOT EXISTS "CarrierTrip_internalTransferId_idx" ON "CarrierTrip"("internalTransferId");

DO $$ BEGIN
  ALTER TABLE "InternalTransfer" ADD CONSTRAINT "InternalTransfer_carrierId_fkey"
    FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CarrierTrip" ADD CONSTRAINT "CarrierTrip_internalTransferId_fkey"
    FOREIGN KEY ("internalTransferId") REFERENCES "InternalTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
