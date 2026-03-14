-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('LIST', 'GROUP', 'ALL_CONTACTS');

-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "import_contacts" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contactListId" TEXT,
    "contactGroupId" TEXT,
    "keepOld" BOOLEAN NOT NULL DEFAULT true,
    "contactsCount" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_contacts" (
    "id" TEXT NOT NULL,
    "fieldNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactListId" TEXT,
    "contactGroupId" TEXT,
    "contactsCount" INTEGER NOT NULL DEFAULT 0,
    "exportType" "ExportType" NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_contacts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "import_contacts" ADD CONSTRAINT "import_contacts_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_contacts" ADD CONSTRAINT "import_contacts_contactGroupId_fkey" FOREIGN KEY ("contactGroupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_contacts" ADD CONSTRAINT "import_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_contacts" ADD CONSTRAINT "export_contacts_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_contacts" ADD CONSTRAINT "export_contacts_contactGroupId_fkey" FOREIGN KEY ("contactGroupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_contacts" ADD CONSTRAINT "export_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
