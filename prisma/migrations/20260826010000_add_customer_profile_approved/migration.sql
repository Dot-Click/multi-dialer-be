-- Tracks whether the Customer Profile (Business Profile) itself is
-- twilio-approved, independently of the broader A2P flow (Brand + Campaign).
-- Voice Integrity and CNAM need only the Customer Profile approved —
-- separating this out unblocks admins in industries whose Brand/Campaign
-- gets rejected by TCR (e.g. real estate, lead-gen).

ALTER TABLE "a2p_registrations"
  ADD COLUMN IF NOT EXISTS "customerProfileApproved" BOOLEAN NOT NULL DEFAULT false;
