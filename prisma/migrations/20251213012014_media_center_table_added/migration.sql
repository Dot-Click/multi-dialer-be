-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('VOICE_MAIL', 'ON_HOLD', 'CALLBACK_MESSAGE', 'EMAIL_VIDEO');

-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('audio', 'video');

-- CreateTable
CREATE TABLE "media_center" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileSize" INTEGER NOT NULL,
    "duration" INTEGER,
    "fileCategory" "FileCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_center_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "media_center" ADD CONSTRAINT "media_center_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
