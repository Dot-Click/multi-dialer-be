-- EmailLog.userId → nullable + ON DELETE SET NULL
--
-- Previously CASCADE — deleting a user permanently wiped every email
-- they had ever sent/received from the analytics dashboard. That's what
-- caused the client's "0% open rate" observation during their GA 4.0
-- end-to-end delete test: the two emails sent/opened during the test
-- disappeared the moment the test account was deleted, leaving nothing
-- for the dashboard to attribute opens to.
--
-- SetNull preserves the historical record; the emails stay in the log
-- (still visible in the analytics dashboard's global stats) but detach
-- from the deleted user's identity, which is the correct semantics for
-- a compliance/audit record anyway.
--
-- Non-destructive: existing rows retain their userId. The column merely
-- becomes nullable, and future user deletes null the column out rather
-- than cascading to delete the log row.

-- DropForeignKey
ALTER TABLE "email_logs" DROP CONSTRAINT "email_logs_userId_fkey";

-- AlterTable
ALTER TABLE "email_logs" ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
