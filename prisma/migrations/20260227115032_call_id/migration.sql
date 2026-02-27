/*
  Warnings:

  - You are about to drop the column `aiPacing` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `dialerType` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `friendlyName` on the `caller_id` table. All the data in the column will be lost.
  - You are about to drop the column `sid` on the `caller_id` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "caller_id" DROP COLUMN "aiPacing",
DROP COLUMN "dialerType",
DROP COLUMN "friendlyName",
DROP COLUMN "sid";
