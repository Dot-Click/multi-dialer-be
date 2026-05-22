-- AlterTable
ALTER TABLE "my_plus_leads_configs" DROP COLUMN "apiKey",
DROP COLUMN "selectedTypes",
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "subAccountEmail" TEXT,
ADD COLUMN     "subAccountId" TEXT,
ADD COLUMN     "subAccountPassword" TEXT;

