-- Sur place / À domicile : type de remise, contact client, dépt livrant à domicile

CREATE TYPE "FulfillmentType" AS ENUM ('ON_SITE', 'HOME');

ALTER TABLE "Department" ADD COLUMN "offersHomeDelivery" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Sale" ADD COLUMN "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'ON_SITE';
ALTER TABLE "Sale" ADD COLUMN "clientPhone" TEXT;
ALTER TABLE "Sale" ADD COLUMN "clientAddress" TEXT;

ALTER TABLE "Delivery" ADD COLUMN "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'ON_SITE';
