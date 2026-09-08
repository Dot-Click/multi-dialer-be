-- Preserve closed-deal GCI when a contact is deleted or merged.
--
-- prospecting_stage_events is the funnel's ledger: CLOSED events and their
-- `gci` live here. The original FK was ON DELETE CASCADE against contacts,
-- so ordinary contact hygiene silently destroyed revenue history —
-- mergeContactsInDb deleting the losing duplicate, the Find Duplicates hard
-- delete, bulkDeleteContactsInDb's purgeOrphans, and the plain single-contact
-- delete. Each quietly shrank the funnel and changed past quarters.
--
-- Order matters below: the denormalised columns are backfilled while the FK
-- still resolves, BEFORE it is relaxed.

-- 1. Traceability for events that outlive their contact.
ALTER TABLE "prospecting_stage_events"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactAddress" TEXT;

-- 2. Backfill from the contacts that still exist. Rows whose contact was
--    already cascaded away are gone entirely — this cannot recover them.
UPDATE "prospecting_stage_events" e
SET "contactName"    = c."fullName",
    "contactAddress" = c."address"
FROM "contacts" c
WHERE c."id" = e."contactId";

-- 3. The event must be able to stand alone.
ALTER TABLE "prospecting_stage_events"
  ALTER COLUMN "contactId" DROP NOT NULL;

-- 4. Stop the bleeding: orphan the event, never delete it.
ALTER TABLE "prospecting_stage_events"
  DROP CONSTRAINT "prospecting_stage_events_contactId_fkey";

ALTER TABLE "prospecting_stage_events"
  ADD CONSTRAINT "prospecting_stage_events_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- NOTE: the UNIQUE (contactId, stage) index is deliberately left alone.
-- Postgres treats NULLs as DISTINCT in a unique index, so any number of
-- orphaned events may share a stage without colliding. A partial index would
-- add nothing.
