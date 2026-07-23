-- AlterTable
ALTER TABLE "DepartmentPrinterProfile" ADD COLUMN IF NOT EXISTS "showLogoOnDisbursement" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DepartmentPrinterProfile" ADD COLUMN IF NOT EXISTS "disbursementHeaderText" TEXT;
ALTER TABLE "DepartmentPrinterProfile" ADD COLUMN IF NOT EXISTS "disbursementFooterText" TEXT;
ALTER TABLE "DepartmentPrinterProfile" ADD COLUMN IF NOT EXISTS "disbursementLogoUrl" TEXT;
ALTER TABLE "DepartmentPrinterProfile" ADD COLUMN IF NOT EXISTS "disbursementPreviewSampleBody" TEXT;
