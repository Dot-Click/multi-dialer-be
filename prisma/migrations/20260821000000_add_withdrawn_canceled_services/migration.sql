-- Seed two new subscribable Lead Store services: Withdrawn and Canceled,
-- $20/mo each. Prisma stores `price` as an integer in Stripe's minor-unit
-- form (cents), so 2000 = $20.00. Idempotent — skips if a row with the
-- same name already exists.
--
-- `id` is a Prisma-managed String column with @default(uuid()) applied at
-- the client layer, so the DB has no default; generate one here with
-- gen_random_uuid() (pgcrypto ships with Postgres 13+).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "lead_store_services" (id, name, price, description, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       'Withdrawn',
       2000,
       'MyPlusLeads Withdrawn listings — monthly access.',
       true,
       NOW(),
       NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "lead_store_services" WHERE name = 'Withdrawn'
);

INSERT INTO "lead_store_services" (id, name, price, description, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       'Canceled',
       2000,
       'MyPlusLeads Canceled listings — monthly access.',
       true,
       NOW(),
       NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "lead_store_services" WHERE name = 'Canceled'
);
