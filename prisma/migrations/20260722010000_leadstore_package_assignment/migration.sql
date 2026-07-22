-- One MyPlusLeads account can carry several data packages (Expired, FSBO, FRBO, ...).
-- lead_stores now records which specific package a purchase is entitled to, and
-- tracks sync bookkeeping per-purchase instead of per-account.
-- NOTE: applied via `prisma db push` (see note in 20260721000000_leadstore_manual_linking
-- for why `prisma migrate dev` can't validate against the shadow DB here). Registered
-- as already-applied via `prisma migrate resolve`.

ALTER TABLE "lead_stores"
  ADD COLUMN "assignedPackage" TEXT,
  ADD COLUMN "lastSyncAt" TIMESTAMP(3),
  ADD COLUMN "syncErrorMessage" TEXT;
