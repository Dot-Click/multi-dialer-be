-- CreateEnum
CREATE TYPE "RecordingType" AS ENUM ('VOICE_MAIL', 'ON_HOLD', 'EMAIL_VIDEO');

-- CreateTable
CREATE TABLE "callback_prompts" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "recordingType" "RecordingType" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "callback_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "callback_prompts_libraryId_templateName_key" ON "callback_prompts"("libraryId", "templateName");

-- AddForeignKey
ALTER TABLE "callback_prompts" ADD CONSTRAINT "callback_prompts_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
