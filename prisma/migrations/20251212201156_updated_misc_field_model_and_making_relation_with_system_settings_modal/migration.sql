/*
  Warnings:

  - You are about to drop the column `userId` on the `misc_fields` table. All the data in the column will be lost.
  - Added the required column `systemSettingId` to the `misc_fields` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "misc_fields" DROP CONSTRAINT "misc_fields_userId_fkey";

-- AlterTable
ALTER TABLE "misc_fields" DROP COLUMN "userId",
ADD COLUMN     "systemSettingId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "misc_fields" ADD CONSTRAINT "misc_fields_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
