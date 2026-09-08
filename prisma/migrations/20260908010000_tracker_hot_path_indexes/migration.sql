-- Index the tables the Prospecting Tracker and AI Sidekick read on every load.
--
-- All three had NOTHING beyond their primary key (call_records also had the
-- callSid unique). Verified against production via pg_indexes, not the schema.
--
-- Plain CREATE INDEX, not CONCURRENTLY: Prisma wraps each migration in a
-- transaction and CONCURRENTLY cannot run inside one. At current volumes
-- (call_records ~26.6k, contact_disposition_logs ~851, agent_sessions ~35)
-- these build in milliseconds. If call_records has grown by orders of
-- magnitude before this ships, build them by hand with CONCURRENTLY instead —
-- CREATE INDEX takes an ACCESS EXCLUSIVE lock and will block writes.

-- Hours rollup: WHERE "userId" = $1 AND "startTime" >= $2 AND < $3
CREATE INDEX "agent_sessions_userId_startTime_idx"
  ON "agent_sessions"("userId", "startTime");

-- AI Sidekick analytics scans and getBestTimeToCall's hourly aggregation.
CREATE INDEX "call_records_userId_startTime_idx"
  ON "call_records"("userId", "startTime");

-- Per-session "last finished call", which the crashed-session hours fallback
-- ladder depends on (see resolveSessionSeconds in rollup.service.ts).
CREATE INDEX "call_records_sessionId_idx"
  ON "call_records"("sessionId");

-- Contacts query: WHERE "appliedById" = $1 AND "createdAt" >= $2, joined to
-- dispositions on "dispositionId", grouped by "contactId".
CREATE INDEX "contact_disposition_logs_appliedById_createdAt_idx"
  ON "contact_disposition_logs"("appliedById", "createdAt");

CREATE INDEX "contact_disposition_logs_dispositionId_idx"
  ON "contact_disposition_logs"("dispositionId");
