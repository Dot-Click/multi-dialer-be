-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "scriptName" TEXT NOT NULL,
    "scriptText" TEXT NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Script_scriptName_key" ON "Script"("scriptName");

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
