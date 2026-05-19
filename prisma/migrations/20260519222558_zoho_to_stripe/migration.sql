-- Step 1: Rename Zoho columns to Stripe columns on user_subscriptions and billings
ALTER TABLE "user_subscriptions" RENAME COLUMN "zohooCustomerId" TO "stripeCustomerId";
ALTER TABLE "billings" RENAME COLUMN "zohooSubscriptionId" TO "stripeSubscriptionId";

-- Step 2: Add stripeSubscriptionId to user_subscriptions
ALTER TABLE "user_subscriptions" ADD COLUMN "stripeSubscriptionId" TEXT;

-- Step 3: Remove Zoho columns from companies table
ALTER TABLE "companies" DROP COLUMN IF EXISTS "zohoApiKey";
ALTER TABLE "companies" DROP COLUMN IF EXISTS "zohoLastSyncedAt";
ALTER TABLE "companies" DROP COLUMN IF EXISTS "zohoOrganizationId";
ALTER TABLE "companies" DROP COLUMN IF EXISTS "zohoSubscriptionsConnected";

-- Step 4: Safely remove ZOHO from IntegrationProvider enum
ALTER TYPE "IntegrationProvider" RENAME TO "IntegrationProvider_old";

CREATE TYPE "IntegrationProvider" AS ENUM (
  'TWILIO',
  'GOOGLE_MAPS',
  'REALTOR_DOT_COM',
  'BOMB_BOMB',
  'GMAIL',
  'STANPP_DOT_COM',
  'MY_PLUS_LEADS',
  'ZAPIER',
  'GO_HIGH_LEVEL'
);

ALTER TABLE "integrations"
  ALTER COLUMN "provider" TYPE "IntegrationProvider"
  USING "provider"::text::"IntegrationProvider";

DROP TYPE "IntegrationProvider_old";
