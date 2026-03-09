/*
  Warnings:

  - Added the required column `number` to the `compliance_dnc` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "user_subscriptions_userId_plan_key";

-- AlterTable
ALTER TABLE "ContactPhone" ADD COLUMN     "isDnc" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "billings" ADD COLUMN     "zohooSubscriptionId" TEXT;

-- AlterTable
ALTER TABLE "calendar" ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "leadId" TEXT;

-- AlterTable
ALTER TABLE "compliance_dnc" ADD COLUMN     "email" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "number" TEXT NOT NULL,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "address" TEXT,
ADD COLUMN     "leadsheetValues" JSONB,
ADD COLUMN     "mailingAddress" TEXT,
ADD COLUMN     "mailingCity" TEXT,
ADD COLUMN     "mailingState" TEXT,
ADD COLUMN     "mailingZip" TEXT,
ADD COLUMN     "miscFieldId" TEXT,
ADD COLUMN     "miscValues" JSONB,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "folders" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "lists" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "user_subscriptions" ADD COLUMN     "amount" TEXT,
ADD COLUMN     "zohooCustomerId" TEXT;

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT,
    "contactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_settings" (
    "id" TEXT NOT NULL,
    "tcpaFrom" TEXT NOT NULL DEFAULT '08:00',
    "tcpaTo" TEXT NOT NULL DEFAULT '20:00',
    "tcpaAutodialing" BOOLEAN NOT NULL DEFAULT false,
    "gdprRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "gdprDeleteRelated" BOOLEAN NOT NULL DEFAULT true,
    "systemSettingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ContactToMiscField" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_settings_systemSettingId_key" ON "regulatory_settings"("systemSettingId");

-- CreateIndex
CREATE UNIQUE INDEX "_ContactToMiscField_AB_unique" ON "_ContactToMiscField"("A", "B");

-- CreateIndex
CREATE INDEX "_ContactToMiscField_B_index" ON "_ContactToMiscField"("B");

-- AddForeignKey
ALTER TABLE "lists" ADD CONSTRAINT "lists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_settings" ADD CONSTRAINT "regulatory_settings_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar" ADD CONSTRAINT "calendar_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar" ADD CONSTRAINT "calendar_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContactToMiscField" ADD CONSTRAINT "_ContactToMiscField_A_fkey" FOREIGN KEY ("A") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContactToMiscField" ADD CONSTRAINT "_ContactToMiscField_B_fkey" FOREIGN KEY ("B") REFERENCES "misc_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
