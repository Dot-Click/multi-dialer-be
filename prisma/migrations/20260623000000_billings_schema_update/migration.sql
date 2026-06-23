-- AlterTable
ALTER TABLE "billings" ADD COLUMN     "cardBrand" TEXT,
ADD COLUMN     "cardLast4" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'usd',
ADD COLUMN     "hostedInvoiceUrl" TEXT,
ADD COLUMN     "invoicePdfUrl" TEXT,
ADD COLUMN     "planName" TEXT,
ADD COLUMN     "stripeInvoiceId" TEXT,
ALTER COLUMN "plan" DROP NOT NULL;
-- CreateIndex
CREATE UNIQUE INDEX "billings_stripeInvoiceId_key" ON "billings"("stripeInvoiceId");
