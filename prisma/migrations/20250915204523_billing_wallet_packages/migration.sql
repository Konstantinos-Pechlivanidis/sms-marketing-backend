-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "public"."CreditTxnType" AS ENUM ('credit', 'debit', 'refund');

-- CreateTable
CREATE TABLE "public"."Wallet" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditTransaction" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "type" "public"."CreditTxnType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" VARCHAR(200),
    "campaignId" INTEGER,
    "messageId" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "walletId" INTEGER,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Package" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Purchase" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "packageId" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'paid',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_ownerId_key" ON "public"."Wallet"("ownerId");

-- CreateIndex
CREATE INDEX "CreditTransaction_ownerId_idx" ON "public"."CreditTransaction"("ownerId");

-- CreateIndex
CREATE INDEX "CreditTransaction_campaignId_idx" ON "public"."CreditTransaction"("campaignId");

-- CreateIndex
CREATE INDEX "CreditTransaction_messageId_idx" ON "public"."CreditTransaction"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Package_name_key" ON "public"."Package"("name");

-- CreateIndex
CREATE INDEX "Purchase_ownerId_idx" ON "public"."Purchase"("ownerId");

-- CreateIndex
CREATE INDEX "Purchase_packageId_idx" ON "public"."Purchase"("packageId");

-- AddForeignKey
ALTER TABLE "public"."Wallet" ADD CONSTRAINT "Wallet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditTransaction" ADD CONSTRAINT "CreditTransaction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditTransaction" ADD CONSTRAINT "CreditTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Purchase" ADD CONSTRAINT "Purchase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Purchase" ADD CONSTRAINT "Purchase_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "public"."Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
