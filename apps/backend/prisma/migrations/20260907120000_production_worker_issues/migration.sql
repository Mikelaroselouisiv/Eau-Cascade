CREATE TABLE IF NOT EXISTS "ProductionWorkerIssue" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "workerId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "productionSessionId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionWorkerIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionWorkerIssue_uuid_key" ON "ProductionWorkerIssue"("uuid");
CREATE INDEX IF NOT EXISTS "ProductionWorkerIssue_workerId_createdAt_idx" ON "ProductionWorkerIssue"("workerId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductionWorkerIssue_departmentId_createdAt_idx" ON "ProductionWorkerIssue"("departmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductionWorkerIssue_productionSessionId_idx" ON "ProductionWorkerIssue"("productionSessionId");
CREATE INDEX IF NOT EXISTS "ProductionWorkerIssue_productId_idx" ON "ProductionWorkerIssue"("productId");

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerIssue" ADD CONSTRAINT "ProductionWorkerIssue_workerId_fkey"
    FOREIGN KEY ("workerId") REFERENCES "ProductionWorker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerIssue" ADD CONSTRAINT "ProductionWorkerIssue_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerIssue" ADD CONSTRAINT "ProductionWorkerIssue_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerIssue" ADD CONSTRAINT "ProductionWorkerIssue_productionSessionId_fkey"
    FOREIGN KEY ("productionSessionId") REFERENCES "ProductionSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerIssue" ADD CONSTRAINT "ProductionWorkerIssue_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
