/*
  Warnings:

  - The `status` column on the `CampaignMessage` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[trackingId]` on the table `CampaignMessage` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `trackingId` to the `CampaignMessage` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."MessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'failed');

-- AlterTable
ALTER TABLE "public"."CampaignMessage" ADD COLUMN     "trackingId" TEXT NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "public"."MessageStatus" NOT NULL DEFAULT 'queued';

-- AlterTable
ALTER TABLE "public"."Contact" ADD COLUMN     "isSubscribed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "unsubscribeTokenHash" VARCHAR(64),
ADD COLUMN     "unsubscribedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."Redemption" (
    "messageId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedByUserId" INTEGER,
    "evidenceJson" JSONB,

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX "Redemption_campaignId_idx" ON "public"."Redemption"("campaignId");

-- CreateIndex
CREATE INDEX "Redemption_contactId_idx" ON "public"."Redemption"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_trackingId_key" ON "public"."CampaignMessage"("trackingId");

-- CreateIndex
CREATE INDEX "CampaignMessage_status_idx" ON "public"."CampaignMessage"("status");

-- CreateIndex
CREATE INDEX "Contact_unsubscribeTokenHash_idx" ON "public"."Contact"("unsubscribeTokenHash");

-- AddForeignKey
ALTER TABLE "public"."Redemption" ADD CONSTRAINT "Redemption_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."CampaignMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
