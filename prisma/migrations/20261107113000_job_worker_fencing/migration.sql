-- Per-claim ownership token used to fence workers running this version.
-- Existing jobs get NULL and are recovered by the new runner when their lease expires.
-- Drain old application/worker processes before enabling this runner: old binaries do not
-- check claimToken and cannot be fenced by this additive schema change.
ALTER TABLE "jobs" ADD COLUMN "claimToken" TEXT;

-- Track supplier cancellation independently from the store-order cancellation.
-- A successful API submission is not the same as supplier confirmation.
-- Legacy rows receive NONE: historical CANCELLED rows can mean local pre-send
-- cancellation, API acceptance, or provider confirmation, so no safe backfill can infer CONFIRMED.
CREATE TYPE "SupplierCancellationStatus" AS ENUM (
    'NONE',
    'REQUESTED',
    'SUBMITTING',
    'SUBMITTED',
    'CONFIRMED',
    'REJECTED',
    'MANUAL_ACTION_REQUIRED'
);

ALTER TABLE "supplier_orders"
    ADD COLUMN "cancellationStatus" "SupplierCancellationStatus" NOT NULL DEFAULT 'NONE',
    ADD COLUMN "cancellationMessage" TEXT;
