/*
  Warnings:

  - You are about to drop the column `listId` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `tag` on the `lists` table. All the data in the column will be lost.
  - You are about to drop the `_ListAgents` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_ListAgents" DROP CONSTRAINT "_ListAgents_A_fkey";

-- DropForeignKey
ALTER TABLE "_ListAgents" DROP CONSTRAINT "_ListAgents_B_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_listId_fkey";

-- DropIndex
DROP INDEX "contacts_listId_idx";

-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "listId",
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "lists" DROP COLUMN "tag",
ADD COLUMN     "agentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "contactIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- DropTable
DROP TABLE "_ListAgents";

-- DropEnum
DROP TYPE "ListTag";
