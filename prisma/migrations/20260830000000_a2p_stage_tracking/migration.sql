-- Per-stage A2P status tracking.
--
-- The existing rollup `status` + single `rejectionReason` collapse three
-- independent Twilio Trust Hub / TCR outcomes (Customer Profile, Brand,
-- Campaign) into one flag, so the UI can only ever say "A2P rejected".
-- Splitting them out lets us surface which stage failed, whether it's
-- retriable, and which downstream features (VI, CNAM) are still unblocked.
--
-- This migration is additive only. Existing rows read NULL until the next
-- checkA2PStatus tick backfills them (see scripts/backfill-a2p-stages.ts
-- for a one-shot post-deploy backfill).

ALTER TABLE "a2p_registrations"
  ADD COLUMN IF NOT EXISTS "cpStatus"                TEXT,
  ADD COLUMN IF NOT EXISTS "cpRejectionReason"       TEXT,
  ADD COLUMN IF NOT EXISTS "cpRejectionCode"         TEXT,
  ADD COLUMN IF NOT EXISTS "cpRetriable"             BOOLEAN,
  ADD COLUMN IF NOT EXISTS "brandStatus"             TEXT,
  ADD COLUMN IF NOT EXISTS "brandRejectionReason"    TEXT,
  ADD COLUMN IF NOT EXISTS "brandRejectionCode"      TEXT,
  ADD COLUMN IF NOT EXISTS "brandRetriable"          BOOLEAN,
  ADD COLUMN IF NOT EXISTS "campaignStatus"          TEXT,
  ADD COLUMN IF NOT EXISTS "campaignRejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "campaignRejectionCode"   TEXT,
  ADD COLUMN IF NOT EXISTS "campaignRetriable"       BOOLEAN;

-- Campaign fields — previously hard-coded real-estate copy in
-- executePhase2. Now user-editable at submit and on resubmit.
ALTER TABLE "a2p_registrations"
  ADD COLUMN IF NOT EXISTS "useCase"          TEXT,
  ADD COLUMN IF NOT EXISTS "businessIndustry" TEXT,
  ADD COLUMN IF NOT EXISTS "messageSamples"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "optInDetails"     TEXT,
  ADD COLUMN IF NOT EXISTS "optInKeywords"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "optOutKeywords"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "helpKeywords"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "helpMessage"      TEXT;

-- Resubmit accounting. Brand resubmits carry a real TCR fee per attempt;
-- the counters power the fee-confirmation copy and any soft cap.
ALTER TABLE "a2p_registrations"
  ADD COLUMN IF NOT EXISTS "brandResubmitCount"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "campaignResubmitCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastResubmitAt"        TIMESTAMP(3);
