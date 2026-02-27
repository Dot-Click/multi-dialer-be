/*
  Warnings:

  - You are about to drop the column `allowDncCalls` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `answeringMachineRecording` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `availableTo` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `callScriptId` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `callerId` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `enableAutoPause` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `enableRecording` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `ivrRecording` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `onHoldRecording1` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `onHoldRecording2` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `ringTime` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `sendEmail` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `sendOutlookAppointment` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `sendText` on the `caller_id` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "caller_id" DROP COLUMN "allowDncCalls",
DROP COLUMN "answeringMachineRecording",
DROP COLUMN "availableTo",
DROP COLUMN "callScriptId",
DROP COLUMN "callerId",
DROP COLUMN "enableAutoPause",
DROP COLUMN "enableRecording",
DROP COLUMN "ivrRecording",
DROP COLUMN "onHoldRecording1",
DROP COLUMN "onHoldRecording2",
DROP COLUMN "ringTime",
DROP COLUMN "sendEmail",
DROP COLUMN "sendOutlookAppointment",
DROP COLUMN "sendText";

-- CreateTable
CREATE TABLE "_CallerIdToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_CallerIdToUser_AB_unique" ON "_CallerIdToUser"("A", "B");

-- CreateIndex
CREATE INDEX "_CallerIdToUser_B_index" ON "_CallerIdToUser"("B");

-- AddForeignKey
ALTER TABLE "_CallerIdToUser" ADD CONSTRAINT "_CallerIdToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "caller_id"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CallerIdToUser" ADD CONSTRAINT "_CallerIdToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
