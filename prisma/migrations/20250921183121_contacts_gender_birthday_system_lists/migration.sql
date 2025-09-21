/*
  Warnings:

  - A unique constraint covering the columns `[ownerId,slug]` on the table `List` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."Gender" AS ENUM ('male', 'female', 'other', 'unknown');

-- AlterTable
ALTER TABLE "public"."Contact" ADD COLUMN     "birthday" TIMESTAMP(3),
ADD COLUMN     "gender" "public"."Gender" NOT NULL DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "public"."List" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slug" VARCHAR(40);

-- CreateIndex
CREATE INDEX "Contact_firstName_idx" ON "public"."Contact"("firstName");

-- CreateIndex
CREATE INDEX "Contact_lastName_idx" ON "public"."Contact"("lastName");

-- CreateIndex
CREATE INDEX "Contact_gender_idx" ON "public"."Contact"("gender");

-- CreateIndex
CREATE INDEX "Contact_birthday_idx" ON "public"."Contact"("birthday");

-- CreateIndex
CREATE UNIQUE INDEX "List_ownerId_slug_key" ON "public"."List"("ownerId", "slug");
