/*
  Warnings:

  - You are about to drop the column `userId` on the `contact_details` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[contactId]` on the table `contact_details` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `contactId` to the `contact_details` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PhoneType" AS ENUM ('MOBILE', 'TELEPHONE');

-- DropForeignKey
ALTER TABLE "contact_details" DROP CONSTRAINT "contact_details_userId_fkey";

-- AlterTable
ALTER TABLE "contact_details" DROP COLUMN "userId",
ADD COLUMN     "contactId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "fullName" TEXT,
    "phoneType" "PhoneType",
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "userId" TEXT NOT NULL,
    "dataDialerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "dataDialerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_lists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "folderId" TEXT,
    "userId" TEXT NOT NULL,
    "dataDialerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dataDialerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ListContacts" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_FolderContacts" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_GroupContacts" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "contacts_userId_idx" ON "contacts"("userId");

-- CreateIndex
CREATE INDEX "contacts_dataDialerId_idx" ON "contacts"("dataDialerId");

-- CreateIndex
CREATE INDEX "contacts_phone_idx" ON "contacts"("phone");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "folders_userId_idx" ON "folders"("userId");

-- CreateIndex
CREATE INDEX "folders_dataDialerId_idx" ON "folders"("dataDialerId");

-- CreateIndex
CREATE INDEX "contact_lists_userId_idx" ON "contact_lists"("userId");

-- CreateIndex
CREATE INDEX "contact_lists_dataDialerId_idx" ON "contact_lists"("dataDialerId");

-- CreateIndex
CREATE INDEX "groups_userId_idx" ON "groups"("userId");

-- CreateIndex
CREATE INDEX "groups_dataDialerId_idx" ON "groups"("dataDialerId");

-- CreateIndex
CREATE UNIQUE INDEX "_ListContacts_AB_unique" ON "_ListContacts"("A", "B");

-- CreateIndex
CREATE INDEX "_ListContacts_B_index" ON "_ListContacts"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_FolderContacts_AB_unique" ON "_FolderContacts"("A", "B");

-- CreateIndex
CREATE INDEX "_FolderContacts_B_index" ON "_FolderContacts"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_GroupContacts_AB_unique" ON "_GroupContacts"("A", "B");

-- CreateIndex
CREATE INDEX "_GroupContacts_B_index" ON "_GroupContacts"("B");

-- CreateIndex
CREATE UNIQUE INDEX "contact_details_contactId_key" ON "contact_details"("contactId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_dataDialerId_fkey" FOREIGN KEY ("dataDialerId") REFERENCES "data_dialers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_dataDialerId_fkey" FOREIGN KEY ("dataDialerId") REFERENCES "data_dialers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_dataDialerId_fkey" FOREIGN KEY ("dataDialerId") REFERENCES "data_dialers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_dataDialerId_fkey" FOREIGN KEY ("dataDialerId") REFERENCES "data_dialers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_details" ADD CONSTRAINT "contact_details_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListContacts" ADD CONSTRAINT "_ListContacts_A_fkey" FOREIGN KEY ("A") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListContacts" ADD CONSTRAINT "_ListContacts_B_fkey" FOREIGN KEY ("B") REFERENCES "contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FolderContacts" ADD CONSTRAINT "_FolderContacts_A_fkey" FOREIGN KEY ("A") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FolderContacts" ADD CONSTRAINT "_FolderContacts_B_fkey" FOREIGN KEY ("B") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupContacts" ADD CONSTRAINT "_GroupContacts_A_fkey" FOREIGN KEY ("A") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupContacts" ADD CONSTRAINT "_GroupContacts_B_fkey" FOREIGN KEY ("B") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
