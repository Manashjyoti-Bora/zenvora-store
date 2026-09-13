-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;
