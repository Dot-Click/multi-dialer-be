import { Request, Response } from "express";
import Stripe from "stripe";
import prisma from "../../lib/prisma";
import { createTwilioSubAccount } from "../../services/twilio-account.service";

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

// Important: Webhooks need raw body for signature verification. 
// Assuming `express.raw({type: 'application/json'})` is handled at the router level for this route.
export const handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"] as string;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

  let stripe: any;

  try {
    stripe = getStripeClient();
  } catch {
    res.status(500).send("Stripe is not configured on this server.");
    return;
  }

  // Use any to avoid 'StripeConstructor has no exported member Event' TS error
  let event: any;

  try {
    // Requires req.body to be raw buffer.
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err: any) {
    console.error(`[Stripe Webhook] Signature verification failed:`, err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle successful checkout
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as any;
    const metadata = session.metadata;

    if (metadata && metadata.email) {
      const { fullName, email, hashedPassword, companyName } = metadata;

      try {
        console.log(`[Stripe Webhook] Processing new signup for ${email}`);
        
        // 1. Create the User in DB
        const user = await prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            fullName,
            role: "ADMIN", // Usually signups become the tenant ADMIN or OWNER
            status: "ACTIVE",
            emailVerified: true, // Assuming payment verifies their intent
          },
        });

        // 2. Create the Company if provided
        if (companyName) {
            await prisma.company.create({
                data: {
                    companyName: companyName,
                    userId: user.id
                }
            });
        }

        // 3. Create the Base System Setting
        const systemSetting = await prisma.system_Setting.create({
          data: {
            userId: user.id,
          },
        });

        // 4. Provision Twilio Subaccount
        try {
            const subAccount = await createTwilioSubAccount(fullName || email);
            
            // Save sub-account credentials as an Integration linked to the System_Setting
            await prisma.integration.create({
                data: {
                    systemSettingId: systemSetting.id,
                    provider: "TWILIO",
                    status: "CONNECTED",
                    credentials: {
                        accountSid: subAccount.sid,
                        authToken: subAccount.authToken
                    }
                }
            });
            console.log(`[Stripe Webhook] Twilio Subaccount provisioned for ${email}`);
        } catch (twilioError: any) {
            console.error(`[Stripe Webhook] Failed to provision Twilio account for ${email}:`, twilioError);
            // We do not fail the whole webhook if Twilio fails, they can retry in dashboard.
        }

        // 5. Setup basic folders (optional workspace setup)
        await prisma.contactFolder.create({
            data: {
                name: "General Leads",
                isSystem: true,
                userId: user.id
            }
        });

      } catch (dbError) {
        console.error(`[Stripe Webhook] Database setup failed for ${email}:`, dbError);
      }
    }
  }

  res.json({ received: true });
};
