/*
  Warnings:

  - You are about to drop the `create_contacts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "create_contacts" DROP CONSTRAINT "create_contacts_dataDialerId_fkey";

-- DropForeignKey
ALTER TABLE "create_contacts" DROP CONSTRAINT "create_contacts_userId_fkey";

-- DropTable
DROP TABLE "create_contacts";
