-- AlterTable
ALTER TABLE "public"."Campaign" ADD COLUMN     "bodyOverride" TEXT,
ALTER COLUMN "templateId" DROP NOT NULL,
ALTER COLUMN "listId" DROP NOT NULL;
