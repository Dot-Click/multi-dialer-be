-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_libraryId_templateName_key" ON "email_templates"("libraryId", "templateName");

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
