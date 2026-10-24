-- CreateTable
-- Shared fixed-window rate-limit counters (see src/lib/rate-limit.ts).
-- Additive: no existing table or column is touched. Safe to apply while the
-- previous application version is still serving traffic.
CREATE TABLE "rate_limit_buckets" (
    "key" VARCHAR(64) NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_buckets_resetAt_idx" ON "rate_limit_buckets"("resetAt");
