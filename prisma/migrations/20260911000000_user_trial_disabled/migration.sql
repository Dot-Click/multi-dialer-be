-- Records a super-admin's decision to create an account WITHOUT a free trial.
-- Defaulted, so existing rows keep today's behaviour (trial granted).
ALTER TABLE "users" ADD COLUMN "trialDisabled" BOOLEAN NOT NULL DEFAULT false;
