-- CreateEnum
CREATE TYPE "PlanKey" AS ENUM ('free', 'minimum', 'plus', 'pro', 'pro_plus_2000', 'pro_plus_3000');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('free', 'active', 'past_due', 'canceled', 'incomplete');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('verified', 'review', 'failed');

-- CreateEnum
CREATE TYPE "BalanceStatus" AS ENUM ('passed', 'review', 'limited');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('verified_conversion', 'review_export', 'refund', 'monthly_reset', 'manual_adjustment');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAccount" (
    "userId" TEXT NOT NULL,
    "planKey" "PlanKey" NOT NULL DEFAULT 'free',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'free',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "monthlyPageAllowance" INTEGER NOT NULL DEFAULT 0,
    "pagesUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "originalFilename" TEXT,
    "pageCount" INTEGER NOT NULL,
    "status" "ConversionStatus" NOT NULL,
    "balanceStatus" "BalanceStatus",
    "creditsCharged" INTEGER NOT NULL DEFAULT 0,
    "chargedAt" TIMESTAMP(3),
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageCreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversionId" TEXT,
    "deltaPages" INTEGER NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeCustomerId_key" ON "BillingAccount"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeSubscriptionId_key" ON "BillingAccount"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Conversion_userId_idx" ON "Conversion"("userId");

-- CreateIndex
CREATE INDEX "PageCreditLedger_userId_idx" ON "PageCreditLedger"("userId");

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageCreditLedger" ADD CONSTRAINT "PageCreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageCreditLedger" ADD CONSTRAINT "PageCreditLedger_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "Conversion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
