-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "import_run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'PENDING',
    "summary" JSONB,
    "error" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_run_projectId_createdAt_idx" ON "import_run"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "import_run_status_updatedAt_idx" ON "import_run"("status", "updatedAt");

-- At most one active import per project. The partial unique index is the
-- authoritative concurrency guard; application checks only improve UX.
CREATE UNIQUE INDEX "import_run_one_active_per_project"
ON "import_run"("projectId")
WHERE "status" IN ('PENDING', 'RUNNING');

-- AddForeignKey
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

