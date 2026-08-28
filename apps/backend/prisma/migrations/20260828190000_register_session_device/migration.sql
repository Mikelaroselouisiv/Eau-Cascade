-- Session caisse : appareil d’ouverture + au plus une session OPEN par user / registre / département.

ALTER TABLE "RegisterSession" ADD COLUMN IF NOT EXISTS "openedDeviceId" TEXT;
ALTER TABLE "RegisterSession" ADD COLUMN IF NOT EXISTS "openedDeviceName" TEXT;

-- Doublons OPEN (garde la plus récente) avant les index uniques partiels.
WITH ranked_user AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "openedById" ORDER BY "openedAt" DESC, id DESC) AS rn
  FROM "RegisterSession"
  WHERE status = 'OPEN' AND "deletedAt" IS NULL
)
UPDATE "RegisterSession" AS rs
SET status = 'CLOSED', "closedAt" = COALESCE(rs."closedAt", NOW()), "updatedAt" = NOW()
FROM ranked_user
WHERE rs.id = ranked_user.id AND ranked_user.rn > 1;

WITH ranked_register AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "registerId" ORDER BY "openedAt" DESC, id DESC) AS rn
  FROM "RegisterSession"
  WHERE status = 'OPEN' AND "deletedAt" IS NULL
)
UPDATE "RegisterSession" AS rs
SET status = 'CLOSED', "closedAt" = COALESCE(rs."closedAt", NOW()), "updatedAt" = NOW()
FROM ranked_register
WHERE rs.id = ranked_register.id AND ranked_register.rn > 1;

WITH ranked_dept AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "departmentId" ORDER BY "openedAt" DESC, id DESC) AS rn
  FROM "RegisterSession"
  WHERE status = 'OPEN' AND "deletedAt" IS NULL
)
UPDATE "RegisterSession" AS rs
SET status = 'CLOSED', "closedAt" = COALESCE(rs."closedAt", NOW()), "updatedAt" = NOW()
FROM ranked_dept
WHERE rs.id = ranked_dept.id AND ranked_dept.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "RegisterSession_one_open_per_user"
  ON "RegisterSession" ("openedById")
  WHERE status = 'OPEN' AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "RegisterSession_one_open_per_register"
  ON "RegisterSession" ("registerId")
  WHERE status = 'OPEN' AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "RegisterSession_one_open_per_department"
  ON "RegisterSession" ("departmentId")
  WHERE status = 'OPEN' AND "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "RegisterSession_openedDeviceId_idx"
  ON "RegisterSession" ("openedDeviceId");
