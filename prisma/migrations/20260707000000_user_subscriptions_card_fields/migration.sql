-- AlterTable
ALTER TABLE "user_subscriptions" ADD COLUMN     "cardBrand" TEXT,
ADD COLUMN     "cardExpMonth" INTEGER,
ADD COLUMN     "cardExpYear" INTEGER,
ADD COLUMN     "cardLast4" TEXT,
ADD COLUMN     "defaultPaymentMethodId" TEXT;
