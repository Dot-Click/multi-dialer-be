-- CreateEnum
CREATE TYPE "EmailQueueStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DEAD');
-- CreateTable
CREATE TABLE "email_queue" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "fromName" TEXT,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT,
    "replyToEmail" TEXT,
    "includeUnsubscribe" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT,
    "userId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "templateId" TEXT,
    "status" "EmailQueueStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_queue_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "email_queue_status_nextRetryAt_idx" ON "email_queue"("status", "nextRetryAt");
