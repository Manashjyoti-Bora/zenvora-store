-- Add CJ Dropshipping to the supplier adapter registry.
-- Postgres enum extension is additive and non-blocking.
ALTER TYPE "SupplierType" ADD VALUE IF NOT EXISTS 'CJ';
