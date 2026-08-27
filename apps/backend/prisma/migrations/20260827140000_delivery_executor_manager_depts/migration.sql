-- Livraison : nom manuel de l’exécutant
ALTER TABLE "Delivery" ADD COLUMN "executorName" TEXT;

-- Gérant : plusieurs départements
CREATE TABLE "UserDepartment" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserDepartment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserDepartment_uuid_key" ON "UserDepartment"("uuid");
CREATE UNIQUE INDEX "UserDepartment_userId_departmentId_key" ON "UserDepartment"("userId", "departmentId");
CREATE INDEX "UserDepartment_userId_idx" ON "UserDepartment"("userId");
CREATE INDEX "UserDepartment_departmentId_idx" ON "UserDepartment"("departmentId");

ALTER TABLE "UserDepartment" ADD CONSTRAINT "UserDepartment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserDepartment" ADD CONSTRAINT "UserDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Affectation actuelle (tous rôles)
INSERT INTO "UserDepartment" ("uuid", "userId", "departmentId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", u."departmentId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
WHERE u."departmentId" IS NOT NULL
  AND u."deletedAt" IS NULL;

-- Gérants : tous les départements de leur entreprise (ils contrôlaient déjà l’enseigne)
INSERT INTO "UserDepartment" ("uuid", "userId", "departmentId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", d."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
INNER JOIN "Department" d ON d."companyId" = u."companyId" AND d."deletedAt" IS NULL
WHERE u.role = 'MANAGER'
  AND u."companyId" IS NOT NULL
  AND u."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "UserDepartment" ud
    WHERE ud."userId" = u."id" AND ud."departmentId" = d."id"
  );
