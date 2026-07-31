-- Track delivery/open/click engagement and bounce type on EmailLog, populated
-- by MailerSend activity webhooks (mailersend.ts). Previously only SENT/FAILED
-- was recorded, so delivered/opened/clicked events were discarded entirely and
-- hard bounces were indistinguishable from ordinary send failures.

-- CreateEnum
CREATE TYPE "BounceType" AS ENUM ('SOFT', 'HARD');

-- AlterTable
ALTER TABLE "email_logs"
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "openedAt" TIMESTAMP(3),
  ADD COLUMN "openCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clickedAt" TIMESTAMP(3),
  ADD COLUMN "clickCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bounceType" "BounceType";
