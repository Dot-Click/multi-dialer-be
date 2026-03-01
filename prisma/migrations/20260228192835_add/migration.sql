/*
  Warnings:

  - You are about to drop the column `answeringMachineRecording` on the `call_settings` table. All the data in the column will be lost.
  - You are about to drop the column `ivrRecording` on the `call_settings` table. All the data in the column will be lost.
  - You are about to drop the column `onHoldRecording1` on the `call_settings` table. All the data in the column will be lost.
  - You are about to drop the column `onHoldRecording2` on the `call_settings` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "RecordingSlot" AS ENUM ('ON_HOLD', 'IVR', 'ANSWERING_MACHINE', 'VOICEMAIL', 'GENERAL');

-- AlterTable
ALTER TABLE "call_settings" DROP COLUMN "answeringMachineRecording",
DROP COLUMN "ivrRecording",
DROP COLUMN "onHoldRecording1",
DROP COLUMN "onHoldRecording2",
ADD COLUMN     "answeringMachineRecordingId" TEXT,
ADD COLUMN     "ivrRecordingId" TEXT,
ADD COLUMN     "onHoldRecording1Id" TEXT,
ADD COLUMN     "onHoldRecording2Id" TEXT;

-- CreateTable
CREATE TABLE "recordings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileSize" INTEGER,
    "duration" INTEGER,
    "mimeType" TEXT,
    "slot" "RecordingSlot" NOT NULL DEFAULT 'GENERAL',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_settings" ADD CONSTRAINT "call_settings_onHoldRecording1Id_fkey" FOREIGN KEY ("onHoldRecording1Id") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_settings" ADD CONSTRAINT "call_settings_onHoldRecording2Id_fkey" FOREIGN KEY ("onHoldRecording2Id") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_settings" ADD CONSTRAINT "call_settings_ivrRecordingId_fkey" FOREIGN KEY ("ivrRecordingId") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_settings" ADD CONSTRAINT "call_settings_answeringMachineRecordingId_fkey" FOREIGN KEY ("answeringMachineRecordingId") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
