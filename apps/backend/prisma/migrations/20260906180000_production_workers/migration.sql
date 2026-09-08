-- CreateTable ProductionWorker
CREATE TABLE IF NOT EXISTS "ProductionWorker" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "payrollCoefficient" DECIMAL(12,4) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionWorker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionWorker_uuid_key" ON "ProductionWorker"("uuid");
CREATE INDEX IF NOT EXISTS "ProductionWorker_departmentId_isActive_idx" ON "ProductionWorker"("departmentId", "isActive");
CREATE INDEX IF NOT EXISTS "ProductionWorker_companyId_name_idx" ON "ProductionWorker"("companyId", "name");

-- CreateTable ProductionWorkerOutput
CREATE TABLE IF NOT EXISTS "ProductionWorkerOutput" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "workerId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "payrollAmount" DECIMAL(12,2) NOT NULL,
    "productionSessionId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionWorkerOutput_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionWorkerOutput_uuid_key" ON "ProductionWorkerOutput"("uuid");
CREATE INDEX IF NOT EXISTS "ProductionWorkerOutput_workerId_createdAt_idx" ON "ProductionWorkerOutput"("workerId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductionWorkerOutput_departmentId_createdAt_idx" ON "ProductionWorkerOutput"("departmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProductionWorkerOutput_productionSessionId_idx" ON "ProductionWorkerOutput"("productionSessionId");
CREATE INDEX IF NOT EXISTS "ProductionWorkerOutput_productId_idx" ON "ProductionWorkerOutput"("productId");

ALTER TABLE "ProductionFlow" ADD COLUMN IF NOT EXISTS "workerOutputId" INTEGER;
CREATE INDEX IF NOT EXISTS "ProductionFlow_workerOutputId_idx" ON "ProductionFlow"("workerOutputId");

DO $$ BEGIN
  ALTER TABLE "ProductionWorker" ADD CONSTRAINT "ProductionWorker_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorker" ADD CONSTRAINT "ProductionWorker_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorker" ADD CONSTRAINT "ProductionWorker_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerOutput" ADD CONSTRAINT "ProductionWorkerOutput_workerId_fkey"
    FOREIGN KEY ("workerId") REFERENCES "ProductionWorker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerOutput" ADD CONSTRAINT "ProductionWorkerOutput_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerOutput" ADD CONSTRAINT "ProductionWorkerOutput_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerOutput" ADD CONSTRAINT "ProductionWorkerOutput_productionSessionId_fkey"
    FOREIGN KEY ("productionSessionId") REFERENCES "ProductionSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionWorkerOutput" ADD CONSTRAINT "ProductionWorkerOutput_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductionFlow" ADD CONSTRAINT "ProductionFlow_workerOutputId_fkey"
    FOREIGN KEY ("workerOutputId") REFERENCES "ProductionWorkerOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
