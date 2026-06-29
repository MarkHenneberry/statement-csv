-- CreateEnum
CREATE TYPE "PreviewSubjectType" AS ENUM ('anonymous_cookie', 'user');

-- CreateTable
CREATE TABLE "FreePreviewUsage" (
    "id" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "subjectType" "PreviewSubjectType" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "pagesUsed" INTEGER NOT NULL DEFAULT 0,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreePreviewUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FreePreviewUsage_subjectHash_windowEnd_idx" ON "FreePreviewUsage"("subjectHash", "windowEnd");
