/*
  Warnings:

  - Added the required column `listId` to the `contacts` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ListTag" AS ENUM ('INTERESTED', 'FOLLOW_UP', 'DNC', 'NOT_INTERESTED');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "listId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "lists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" "ListTag" NOT NULL,

    CONSTRAINT "lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ListAgents" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_ListAgents_AB_unique" ON "_ListAgents"("A", "B");

-- CreateIndex
CREATE INDEX "_ListAgents_B_index" ON "_ListAgents"("B");

-- CreateIndex
CREATE INDEX "contacts_listId_idx" ON "contacts"("listId");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_listId_fkey" FOREIGN KEY ("listId") REFERENCES "lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListAgents" ADD CONSTRAINT "_ListAgents_A_fkey" FOREIGN KEY ("A") REFERENCES "lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListAgents" ADD CONSTRAINT "_ListAgents_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
