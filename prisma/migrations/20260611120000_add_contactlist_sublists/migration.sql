-- Add self-relation to support single-level sub-lists on ContactList ("lists").
-- Deleting a parent list cascades to its child lists.

ALTER TABLE "lists" ADD COLUMN "parentId" TEXT;

ALTER TABLE "lists"
  ADD CONSTRAINT "lists_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "lists"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "lists_parentId_idx" ON "lists"("parentId");
