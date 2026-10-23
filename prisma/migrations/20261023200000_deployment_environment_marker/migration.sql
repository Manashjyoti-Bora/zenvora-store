-- CreateTable
-- Release-safety marker (see scripts/release.ts). Single row, id is always 1.
CREATE TABLE "deployment_environment" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "environment" TEXT NOT NULL,
    "databaseHost" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_environment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deployment_environment_singleton" CHECK ("id" = 1)
);
