import session from "express-session";
import twilio from "twilio";


export const envConfig = {

  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  BACKEND_URL: process.env.BACKEND_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  MAILERSEND_API_KEY: process.env.MAILERSEND_API_KEY,
  MAILERSEND_FROM_EMAIL: process.env.MAILERSEND_FROM_EMAIL,
  MAILERSEND_FROM_NAME: process.env.MAILERSEND_FROM_NAME,
  MAILERSEND_WEBHOOK_SECRET: process.env.MAILERSEND_WEBHOOK_SECRET,
  // Hosted URL for the logo shown in the shared email footer (utils/emailFooter.ts).
  // Not yet set — until it is, the footer omits the <img> rather than showing
  // a broken-image icon in every outgoing email.
  EMAIL_LOGO_URL: process.env.EMAIL_LOGO_URL,

  // MailerSend-hosted template IDs (from the dashboard's Template Library).
  // Each defaults to the ID the client has already imported and confirmed
  // live; override via env when the ID changes or a new template is
  // swapped in.
  MAILERSEND_TEMPLATE_WELCOME_AGENT: process.env.MAILERSEND_TEMPLATE_WELCOME_AGENT || "jpzkmgq5mrng059v",
  MAILERSEND_TEMPLATE_PASSWORD_RESET: process.env.MAILERSEND_TEMPLATE_PASSWORD_RESET || "3z0vklo5d1747qrx",
  MAILERSEND_TEMPLATE_MEMBER_REMOVED: process.env.MAILERSEND_TEMPLATE_MEMBER_REMOVED || "7dnvo4dywj645r86",
  GROK_API_KEY: process.env.GROK_API_KEY,
  EMAIL_USER: process.env.EMAIL_USER,

  // AWS SES (email sending) — retired in favor of MailerSend, kept for reference.
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  SES_FROM_EMAIL: process.env.SES_FROM_EMAIL,
  SES_FROM_NAME: process.env.SES_FROM_NAME,
  SES_CONFIGURATION_SET: process.env.SES_CONFIGURATION_SET,
  SES_SNS_TOPIC_ARN: process.env.SES_SNS_TOPIC_ARN,

  SESSION_SECRET: process.env.SESSION_SECRET,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  TWILIO_API_KEY: process.env.TWILIO_API_KEY,
  TWILIO_API_SECRET: process.env.TWILIO_API_SECRET,
  TWILIO_TWIML_APP_SID: process.env.TWILIO_TWIML_APP_SID,
  // Pinned SID of the ISV master's approved Primary Customer Profile that
  // Secondary CPs (per sub-account admin) link to during A2P onboarding.
  // Optional — if unset, the A2P service falls back to discovering the
  // first twilio-approved profile via customerProfiles.list().
  TWILIO_MASTER_PRIMARY_CUSTOMER_PROFILE_SID: process.env.TWILIO_MASTER_PRIMARY_CUSTOMER_PROFILE_SID,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  ZILLOW_RAPIDAPI_KEY: process.env.ZILLOW_RAPIDAPI_KEY,
  ZILLOW_RAPIDAPI_HOST: process.env.ZILLOW_RAPIDAPI_HOST,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_BILLING_PORTAL_CONFIG: process.env.STRIPE_BILLING_PORTAL_CONFIG,
  STRIPE_PRICE_BASIC: process.env.STRIPE_PRICE_BASIC,
  STRIPE_PRICE_STANDARD: process.env.STRIPE_PRICE_STANDARD,
  STRIPE_PRICE_PREMIUM: process.env.STRIPE_PRICE_PREMIUM,

  GHL_API_KEY: process.env.GHL_API_KEY,
  GHL_AGENCY_API_KEY: process.env.GHL_AGENCY_API_KEY,
  GHL_AGENCY_ID: process.env.GHL_AGENCY_ID,
  LEAD_STORE_REMINDER_HOURS: process.env.LEAD_STORE_REMINDER_HOURS,
  LEAD_STORE_PAUSE_HOURS: process.env.LEAD_STORE_PAUSE_HOURS,
  MYPLUSLEADS_ENTERPRISE_EMAIL: process.env.MYPLUSLEADS_ENTERPRISE_EMAIL,
  MYPLUSLEADS_ENTERPRISE_PASSWORD: process.env.MYPLUSLEADS_ENTERPRISE_PASSWORD,
  ZAPIER_WEBHOOK_URL: process.env.ZAPIER_WEBHOOK_URL,
  YOUMAIL_API_SID: process.env.YOUMAIL_API_SID,
  YOUMAIL_API_KEY: process.env.YOUMAIL_API_KEY,
  EIN_ENCRYPTION_KEY: process.env.EIN_ENCRYPTION_KEY,
  SMTP_ENCRYPTION_KEY: process.env.SMTP_ENCRYPTION_KEY,

  // R2 Configuration
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
}




export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET as string,
  resave: false,
  saveUninitialized: true,
});

import { S3Client } from "@aws-sdk/client-s3";


const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

export default r2;

export const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
