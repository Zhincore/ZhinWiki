-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'MERGED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "page" ADD COLUMN     "forkFingerprint" TEXT,
ADD COLUMN     "sourcePageId" TEXT;

-- CreateTable
CREATE TABLE "change_request" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "authorId" TEXT,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "branchId" TEXT,
    "mergedById" TEXT,
    "mergedAt" TIMESTAMP(3),
    "forkBase" JSONB,
    "mergeRecord" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_request_branchId_key" ON "change_request"("branchId");

-- CreateIndex
CREATE INDEX "change_request_projectId_status_idx" ON "change_request"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_request_projectId_number_key" ON "change_request"("projectId", "number");

-- CreateIndex
CREATE INDEX "page_sourcePageId_idx" ON "page"("sourcePageId");

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page" ADD CONSTRAINT "page_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every existing non-default branch except import replacement branches becomes
-- a draft change request, numbered per project in branch creation order.
INSERT INTO "change_request" ("id", "projectId", "number", "title", "status", "branchId", "createdAt", "updatedAt")
SELECT
    'cr_' || md5(random()::text || b."id"),
    b."projectId",
    row_number() OVER (PARTITION BY b."projectId" ORDER BY b."createdAt", b."id"),
    b."name",
    'DRAFT',
    b."id",
    b."createdAt",
    CURRENT_TIMESTAMP
FROM "branch" b
WHERE b."isDefault" = false AND b."name" NOT LIKE 'import-%';
