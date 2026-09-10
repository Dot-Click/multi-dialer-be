/**
 * Trial-tier constants — single source of truth for anything that depends
 * on the length of a trial or the caps that apply during it.
 *
 * Anywhere `30` appeared as a magic trial length or `2` as a magic
 * caller-id cap should reference these instead. Change here → applies
 * everywhere (Stripe checkout, lifecycle emails, purchase guards).
 */

/**
 * How long a fresh admin's Stripe trial lasts before the first payment
 * attempt. Passed as `trial_period_days` to Stripe checkout.
 */
export const TRIAL_PERIOD_DAYS = 5;

/**
 * Days-before-trial-end when we send the "trial ending soon" reminder email.
 * Fires when the admin's `createdAt` is between DAYS - EMAIL_ADVANCE
 * and DAYS - EMAIL_ADVANCE + 1 (i.e. a 1-day window at day N-1 of trial).
 */
export const TRIAL_ENDING_SOON_EMAIL_ADVANCE_DAYS = 1;

/**
 * Hard cap on the number of caller-ids a trial admin may hold. Applies
 * to initial signup provisioning AND to self-service / on-behalf-of
 * purchase flows. Lifted the moment the admin's trial converts to a paid
 * subscription (trialStatus flips to NONE and isSubscribed to true).
 */
export const TRIAL_NUMBER_CAP = 2;

/**
 * Slack allowed when deciding whether an ACTIVE `trialStatus` is stale.
 *
 * `trialStatus` is only ever cleared by the customer.subscription.updated
 * webhook, so any account whose trialing→active transition was missed keeps
 * `ACTIVE` forever — production currently has paid `pro` accounts in exactly
 * that state. A genuine trial's billing period ends within TRIAL_PERIOD_DAYS
 * (Stripe pins current_period_end to trial_end while trialing), so a
 * subscription whose period ends well past that belongs to a converted,
 * paying account no matter what the flag says. This is the buffer on that
 * comparison, covering clock skew and same-day renewals.
 */
export const TRIAL_STALE_FLAG_GRACE_DAYS = 2;
