/*
  Warnings:

  - A unique constraint covering the columns `[ownerId,phone]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[ownerId,name]` on the table `List` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[ownerId,name]` on the table `MessageTemplate` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `ownerId` to the `Campaign` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerId` to the `CampaignMessage` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerId` to the `Contact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerId` to the `List` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerId` to the `MessageTemplate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerId` to the `Redemption` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."Contact_phone_key";

-- DropIndex
DROP INDEX "public"."List_name_key";

-- DropIndex
DROP INDEX "public"."MessageTemplate_name_key";

-- AlterTable
ALTER TABLE "public"."Campaign" ADD COLUMN     "ownerId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."CampaignMessage" ADD COLUMN     "ownerId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."Contact" ADD COLUMN     "ownerId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."List" ADD COLUMN     "ownerId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."MessageTemplate" ADD COLUMN     "ownerId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."Redemption" ADD COLUMN     "ownerId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "Campaign_createdAt_idx" ON "public"."Campaign"("createdAt");

-- CreateIndex
CREATE INDEX "Campaign_ownerId_idx" ON "public"."Campaign"("ownerId");

-- CreateIndex
CREATE INDEX "CampaignMessage_ownerId_idx" ON "public"."CampaignMessage"("ownerId");

-- CreateIndex
CREATE INDEX "Contact_ownerId_idx" ON "public"."Contact"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_ownerId_phone_key" ON "public"."Contact"("ownerId", "phone");

-- CreateIndex
CREATE INDEX "List_ownerId_idx" ON "public"."List"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "List_ownerId_name_key" ON "public"."List"("ownerId", "name");

-- CreateIndex
CREATE INDEX "MessageTemplate_ownerId_idx" ON "public"."MessageTemplate"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_ownerId_name_key" ON "public"."MessageTemplate"("ownerId", "name");

-- CreateIndex
CREATE INDEX "Redemption_ownerId_idx" ON "public"."Redemption"("ownerId");

-- AddForeignKey
ALTER TABLE "public"."Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."List" ADD CONSTRAINT "List_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MessageTemplate" ADD CONSTRAINT "MessageTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignMessage" ADD CONSTRAINT "CampaignMessage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Redemption" ADD CONSTRAINT "Redemption_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
