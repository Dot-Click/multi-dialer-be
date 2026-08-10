-- Product decision: a contact may only have one ACTIVE action plan
-- assignment at a time. ActionPlanService.assignToContact() now blocks a
-- second assignment at the application layer, but the old "Assign Another
-- Plan" UI previously allowed multiple simultaneous ACTIVE assignments per
-- contact with no constraint at all, so pre-existing data may already
-- violate this. Resolve that first: for any contact with more than one
-- ACTIVE row, keep only the most recently created one ACTIVE and mark the
-- rest REMOVED. Without this cleanup the unique index below would fail to
-- create wherever a violation already exists.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "contactId" ORDER BY "createdAt" DESC) AS rn
  FROM "contact_action_plans"
  WHERE status = 'ACTIVE'
)
UPDATE "contact_action_plans"
SET status = 'REMOVED', "removedAt" = NOW()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Partial unique index: at most one row per contactId where status = 'ACTIVE'.
-- This is the DB-level backstop behind the application check — it holds even
-- under a race condition or a future code path that bypasses
-- ActionPlanService.assignToContact(). Prisma's schema DSL has no syntax for
-- WHERE-qualified unique indexes, so this constraint exists only here in raw
-- SQL and is intentionally not (and cannot be) represented in schema.prisma.
-- Do not let a future `prisma migrate dev` "fix" perceived drift by dropping it.
CREATE UNIQUE INDEX "contact_action_plans_one_active_per_contact" ON "contact_action_plans"("contactId") WHERE status = 'ACTIVE';
