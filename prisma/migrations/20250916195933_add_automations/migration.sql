-- CreateTable
CREATE TABLE "public"."Automation" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Automation_ownerId_isActive_idx" ON "public"."Automation"("ownerId", "isActive");

-- CreateIndex
CREATE INDEX "Automation_ownerId_trigger_idx" ON "public"."Automation"("ownerId", "trigger");

-- AddForeignKey
ALTER TABLE "public"."Automation" ADD CONSTRAINT "Automation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
