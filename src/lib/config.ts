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
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  GROK_API_KEY: process.env.GROK_API_KEY,
  EMAIL_USER: process.env.EMAIL_USER,

  // AWS SES (email sending)
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
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  REALTOR_RAPIDAPI_KEY: process.env.REALTOR_RAPIDAPI_KEY,
  REALTOR_RAPIDAPI_HOST: process.env.REALTOR_RAPIDAPI_HOST,

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
  MYPLUSLEADS_PORTAL_EMAIL: process.env.MYPLUSLEADS_PORTAL_EMAIL,
  MYPLUSLEADS_PORTAL_PASSWORD: process.env.MYPLUSLEADS_PORTAL_PASSWORD,
  ZAPIER_WEBHOOK_URL: process.env.ZAPIER_WEBHOOK_URL,
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
