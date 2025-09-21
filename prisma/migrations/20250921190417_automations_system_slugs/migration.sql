/*
  Warnings:

  - A unique constraint covering the columns `[ownerId,systemSlug]` on the table `Automation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Automation" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "systemSlug" VARCHAR(40);

-- CreateIndex
CREATE UNIQUE INDEX "Automation_ownerId_systemSlug_key" ON "public"."Automation"("ownerId", "systemSlug");
