-- Drop the four columns `model Appearance` no longer declares.
--
-- Appearance became a pure feature-toggle row (16 booleans + id +
-- systemSettingId + timestamps), but these columns were created by
-- 20251216224425_appearance_name_coorection and recreated by
-- 20260130192445_company_model_added, and no migration ever removed them.
-- The result is permanent drift: every `prisma db push` / `migrate dev`
-- proposes dropping them, so an unrelated schema change hands the operator a
-- destructive prompt mid-deploy.
--
-- INSERTs were unaffected (all four are NOT NULL with defaults), which is why
-- this sat unnoticed. Reads were not: the regulatory service wrote to
-- `timeZone` long after the model forgot it, and Prisma rejected the whole
-- transaction with "Unknown argument `timeZone`" — that is what broke saving
-- a company timezone in Compliance & DNC.
--
-- IF EXISTS throughout: a prior `db push` may already have removed some or
-- all of these, and this needs to apply cleanly whatever state an environment
-- drifted into.

ALTER TABLE "appearance" DROP COLUMN IF EXISTS "timeZone";
ALTER TABLE "appearance" DROP COLUMN IF EXISTS "lockGroups";
ALTER TABLE "appearance" DROP COLUMN IF EXISTS "birthdays";
ALTER TABLE "appearance" DROP COLUMN IF EXISTS "homeCloseDate";
