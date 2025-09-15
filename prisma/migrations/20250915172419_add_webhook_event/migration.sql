-- CreateTable
CREATE TABLE "public"."WebhookEvent" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "providerMessageId" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_eventType_idx" ON "public"."WebhookEvent"("provider", "eventType");

-- CreateIndex
CREATE INDEX "WebhookEvent_providerMessageId_idx" ON "public"."WebhookEvent"("providerMessageId");
