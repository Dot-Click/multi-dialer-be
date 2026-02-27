-- CreateEnum
CREATE TYPE "DialerType" AS ENUM ('PREDICTIVE', 'POWER', 'PREVIEW');

-- AlterTable
ALTER TABLE "caller_id" ADD COLUMN     "aiPacing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dialerType" "DialerType" NOT NULL DEFAULT 'POWER';
