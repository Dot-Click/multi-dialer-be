-- AlterTable
ALTER TABLE "call_settings" ADD COLUMN     "dialerMode" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "pacing" INTEGER NOT NULL DEFAULT 1;
