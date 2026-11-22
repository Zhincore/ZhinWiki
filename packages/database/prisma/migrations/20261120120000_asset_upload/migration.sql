-- Presigned member uploads awaiting confirmation; swept by the worker when never confirmed.
CREATE TABLE "asset_upload" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_upload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_upload_key_key" ON "asset_upload"("key");
CREATE INDEX "asset_upload_createdAt_idx" ON "asset_upload"("createdAt");

ALTER TABLE "asset_upload" ADD CONSTRAINT "asset_upload_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
