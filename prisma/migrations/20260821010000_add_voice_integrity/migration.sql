-- Twilio Voice Integrity support.
-- 1) New IntegrationProvider value for the per-admin Trust Hub enrolment row
--    (stores customerProfileSid / trustProductSid / endUserSid + status in
--    the shared integrations.credentials JSON blob — no new table needed).
-- 2) Two columns on caller_id for the per-number Trust-Product assignment:
--    the assignment SID (what we DELETE to unassign) and a bool the frontend
--    can read to show a "Registered / Pending / Not enrolled" badge without
--    round-tripping to Twilio on every render.

ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'TWILIO_VOICE_INTEGRITY';

ALTER TABLE "caller_id"
  ADD COLUMN IF NOT EXISTS "voiceIntegrityAssignmentSid" TEXT,
  ADD COLUMN IF NOT EXISTS "voiceIntegrityRegistered"    BOOLEAN NOT NULL DEFAULT false;
