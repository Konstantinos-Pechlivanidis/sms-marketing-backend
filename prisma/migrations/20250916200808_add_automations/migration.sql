-- DropForeignKey
ALTER TABLE "public"."Automation" DROP CONSTRAINT "Automation_ownerId_fkey";

-- AddForeignKey
ALTER TABLE "public"."Automation" ADD CONSTRAINT "Automation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
