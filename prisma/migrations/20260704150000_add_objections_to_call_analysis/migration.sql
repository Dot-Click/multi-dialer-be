-- AlterTable
ALTER TABLE "call_analysis" ADD COLUMN "objections" TEXT[] DEFAULT ARRAY[]::TEXT[];
