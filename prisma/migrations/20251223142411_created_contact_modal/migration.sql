/*
  Warnings:

  - You are about to drop the column `createdAt` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the `_FolderContacts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_GroupContacts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_ListContacts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `contact_details` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `contact_lists` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `folders` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `groups` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `phoneNumber` to the `contacts` table without a default value. This is not possible if the table is not empty.
  - Made the column `fullName` on table `contacts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `phoneType` on table `contacts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `email` on table `contacts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `address` on table `contacts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `city` on table `contacts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `state` on table `contacts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `zip` on table `contacts` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "_FolderContacts" DROP CONSTRAINT "_FolderContacts_A_fkey";

-- DropForeignKey
ALTER TABLE "_FolderContacts" DROP CONSTRAINT "_FolderContacts_B_fkey";

-- DropForeignKey
ALTER TABLE "_GroupContacts" DROP CONSTRAINT "_GroupContacts_A_fkey";

-- DropForeignKey
ALTER TABLE "_GroupContacts" DROP CONSTRAINT "_GroupContacts_B_fkey";

-- DropForeignKey
ALTER TABLE "_ListContacts" DROP CONSTRAINT "_ListContacts_A_fkey";

-- DropForeignKey
ALTER TABLE "_ListContacts" DROP CONSTRAINT "_ListContacts_B_fkey";

-- DropForeignKey
ALTER TABLE "contact_details" DROP CONSTRAINT "contact_details_contactId_fkey";

-- DropForeignKey
ALTER TABLE "contact_lists" DROP CONSTRAINT "contact_lists_dataDialerId_fkey";

-- DropForeignKey
ALTER TABLE "contact_lists" DROP CONSTRAINT "contact_lists_folderId_fkey";

-- DropForeignKey
ALTER TABLE "contact_lists" DROP CONSTRAINT "contact_lists_userId_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_dataDialerId_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_userId_fkey";

-- DropForeignKey
ALTER TABLE "folders" DROP CONSTRAINT "folders_dataDialerId_fkey";

-- DropForeignKey
ALTER TABLE "folders" DROP CONSTRAINT "folders_parentId_fkey";

-- DropForeignKey
ALTER TABLE "folders" DROP CONSTRAINT "folders_userId_fkey";

-- DropForeignKey
ALTER TABLE "groups" DROP CONSTRAINT "groups_dataDialerId_fkey";

-- DropForeignKey
ALTER TABLE "groups" DROP CONSTRAINT "groups_userId_fkey";

-- DropIndex
DROP INDEX "contacts_phone_idx";

-- DropIndex
DROP INDEX "contacts_userId_idx";

-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "createdAt",
DROP COLUMN "phone",
DROP COLUMN "updatedAt",
DROP COLUMN "userId",
ADD COLUMN     "phoneNumber" TEXT NOT NULL,
ALTER COLUMN "fullName" SET NOT NULL,
ALTER COLUMN "phoneType" SET NOT NULL,
ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "address" SET NOT NULL,
ALTER COLUMN "city" SET NOT NULL,
ALTER COLUMN "state" SET NOT NULL,
ALTER COLUMN "zip" SET NOT NULL,
ALTER COLUMN "dataDialerId" DROP NOT NULL;

-- DropTable
DROP TABLE "_FolderContacts";

-- DropTable
DROP TABLE "_GroupContacts";

-- DropTable
DROP TABLE "_ListContacts";

-- DropTable
DROP TABLE "contact_details";

-- DropTable
DROP TABLE "contact_lists";

-- DropTable
DROP TABLE "folders";

-- DropTable
DROP TABLE "groups";

-- CreateIndex
CREATE INDEX "contacts_phoneNumber_idx" ON "contacts"("phoneNumber");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_dataDialerId_fkey" FOREIGN KEY ("dataDialerId") REFERENCES "data_dialers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
