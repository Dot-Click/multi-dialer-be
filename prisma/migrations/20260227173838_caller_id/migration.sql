-- AlterTable
ALTER TABLE "caller_id" ADD COLUMN     "aiPacing" BOOLEAN DEFAULT false,
ADD COLUMN     "dialerType" "DialerType" DEFAULT 'PREDICTIVE';
