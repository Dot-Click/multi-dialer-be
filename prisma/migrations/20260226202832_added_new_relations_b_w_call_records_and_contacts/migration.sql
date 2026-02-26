-- AlterTable
ALTER TABLE "call_records" ADD COLUMN     "contactId" TEXT,
ALTER COLUMN "leadId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
