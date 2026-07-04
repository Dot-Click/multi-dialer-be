-- AlterTable
ALTER TABLE "call_analysis" ADD COLUMN "complianceFlags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "call_analysis" ADD COLUMN "riskPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[];
