-- CreateTable
CREATE TABLE "contact_dispositions" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dispositionId" TEXT NOT NULL,
    "appliedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_dispositions_contactId_idx" ON "contact_dispositions"("contactId");

-- CreateIndex
CREATE INDEX "contact_dispositions_dispositionId_idx" ON "contact_dispositions"("dispositionId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_dispositions_contactId_dispositionId_key" ON "contact_dispositions"("contactId", "dispositionId");

-- AddForeignKey
ALTER TABLE "contact_dispositions" ADD CONSTRAINT "contact_dispositions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_dispositions" ADD CONSTRAINT "contact_dispositions_dispositionId_fkey" FOREIGN KEY ("dispositionId") REFERENCES "dispositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_dispositions" ADD CONSTRAINT "contact_dispositions_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
