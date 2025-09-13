-- CreateTable
CREATE TABLE "public"."Bootstrap" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bootstrap_pkey" PRIMARY KEY ("id")
);
