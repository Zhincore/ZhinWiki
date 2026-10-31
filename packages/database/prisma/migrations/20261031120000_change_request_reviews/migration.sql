-- CreateEnum
CREATE TYPE "ChangeRequestReviewState" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED');

-- CreateTable
CREATE TABLE "change_request_reviewer" (
    "changeRequestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_request_reviewer_pkey" PRIMARY KEY ("changeRequestId","userId")
);

-- CreateTable
CREATE TABLE "change_request_review" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "authorId" TEXT,
    "state" "ChangeRequestReviewState" NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_request_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_request_reviewer_userId_idx" ON "change_request_reviewer"("userId");

-- CreateIndex
CREATE INDEX "change_request_review_changeRequestId_createdAt_idx" ON "change_request_review"("changeRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "change_request_reviewer" ADD CONSTRAINT "change_request_reviewer_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request_reviewer" ADD CONSTRAINT "change_request_reviewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request_reviewer" ADD CONSTRAINT "change_request_reviewer_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request_review" ADD CONSTRAINT "change_request_review_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request_review" ADD CONSTRAINT "change_request_review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
