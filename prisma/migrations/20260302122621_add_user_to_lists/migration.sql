/*
  Warnings:

  - Added the required column `userId` to the `folders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `groups` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `lists` table without a default value. This is not possible if the table is not empty.

*/
ALTER TABLE "folders" ADD COLUMN     "userId" TEXT;
ALTER TABLE "groups" ADD COLUMN     "userId" TEXT;
ALTER TABLE "lists" ADD COLUMN     "userId" TEXT;
ALTER TABLE "lists" ADD CONSTRAINT "lists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "folders" ADD CONSTRAINT "folders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "groups" ADD CONSTRAINT "groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
