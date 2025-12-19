-- CreateTable
CREATE TABLE "create_contacts" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneType" TEXT NOT NULL DEFAULT 'Mobile',
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "folderId" TEXT,
    "listId" TEXT,
    "groupId" TEXT,
    "dataDialerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "create_contacts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "create_contacts" ADD CONSTRAINT "create_contacts_dataDialerId_fkey" FOREIGN KEY ("dataDialerId") REFERENCES "data_dialers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "create_contacts" ADD CONSTRAINT "create_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
