-- CreateEnum
CREATE TYPE "LeadCallStatus" AS ENUM ('PENDING', 'CALLING', 'CALLED', 'FAILED', 'BUSY', 'NO_ANSWER');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "LeadCallStatus" NOT NULL DEFAULT 'PENDING';
