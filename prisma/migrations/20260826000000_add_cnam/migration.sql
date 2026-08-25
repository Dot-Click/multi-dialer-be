-- Twilio CNAM (branded caller name) support. Same pattern as Voice Integrity:
-- one Integration row per admin holds the Trust Hub SIDs + status + the
-- 15-char display name; caller_id gets two columns for per-number assignment.

ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'TWILIO_CNAM';

ALTER TABLE "caller_id"
  ADD COLUMN IF NOT EXISTS "cnamAssignmentSid" TEXT,
  ADD COLUMN IF NOT EXISTS "cnamRegistered"    BOOLEAN NOT NULL DEFAULT false;
