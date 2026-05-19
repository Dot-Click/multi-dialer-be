import { v2 as cloudinary } from "cloudinary";
import session from "express-session";
import twilio from "twilio";


export const envConfig =  {
    
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
        
        GHL_API_KEY: process.env.GHL_API_KEY,
        GHL_AGENCY_API_KEY: process.env.GHL_AGENCY_API_KEY,
        GHL_AGENCY_ID: process.env.GHL_AGENCY_ID,
        ZAPIER_WEBHOOK_URL: process.env.ZAPIER_WEBHOOK_URL,
        EIN_ENCRYPTION_KEY: process.env.EIN_ENCRYPTION_KEY,
}




export const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET as string,
    resave: false,
    saveUninitialized: true,
  });

/**
 * cloudinary configuration function and uploader
 * @returns cloudinary configuration object and cloudinary uploader
 */
export const cloudinaryConfig = () =>
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

export const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
