-- AlterTable
ALTER TABLE "import_run" ADD COLUMN "errorCode" TEXT,
ADD COLUMN "errorDetails" JSONB;
