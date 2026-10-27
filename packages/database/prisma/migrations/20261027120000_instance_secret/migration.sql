-- CreateTable
CREATE TABLE "instance_secret" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instance_secret_pkey" PRIMARY KEY ("key")
);
