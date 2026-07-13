-- Persist the power-dialer session defaults on call settings.
-- `numberOfLines` is the dials-per-caller-ID rotation threshold; `pacing` is
-- the simultaneous-line count. Both were previously lost on save, so a saved
-- configuration always reloaded as manual mode at 1x speed.
ALTER TABLE "call_settings" ADD COLUMN "dialerMode" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "call_settings" ADD COLUMN "pacing" INTEGER NOT NULL DEFAULT 1;
