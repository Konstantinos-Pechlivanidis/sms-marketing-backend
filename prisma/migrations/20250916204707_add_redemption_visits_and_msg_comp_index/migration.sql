/*
  Warnings:

  - You are about to alter the column `phone` on the `Contact` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.

*/
-- AlterTable
ALTER TABLE "public"."Contact" ALTER COLUMN "phone" SET DATA TYPE VARCHAR(20);

-- AlterTable
ALTER TABLE "public"."Redemption" ADD COLUMN     "lastVisitedAt" TIMESTAMP(3),
ADD COLUMN     "visits" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "CampaignMessage_campaignId_status_idx" ON "public"."CampaignMessage"("campaignId", "status");
