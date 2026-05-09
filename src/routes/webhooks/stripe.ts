import { Request, Response } from "express";
import Stripe from "stripe";
import prisma from "../../lib/prisma";
import { createTwilioSubAccount, purchaseUSPhoneNumber } from "../../services/twilio-account.service";
import { createGHLSubAccount } from "../../services/ghl.service";
import { envConfig } from "../../lib/config";

function getStripeClient() {
  const key = envConfig.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

// Important: Webhooks need raw body for signature verification. 
// Assuming `express.raw({type: 'application/json'})` is handled at the router level for this route.
export const handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"] as string;
  const endpointSecret = envConfig.STRIPE_WEBHOOK_SECRET || "";

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
        let company;
        if (companyName) {
            company = await prisma.company.create({
                data: {
                    companyName: companyName,
                    userId: user.id
                }
            });
        }

        // 2.5 Create GoHighLevel Sub-account
        try {
            console.log(`[Stripe Webhook] Provisioning GHL for ${email}`);
            const ghlLocation = await createGHLSubAccount({
                name: companyName || fullName || email,
                email: email,
            });
            
            if (company) {
                company = await prisma.company.update({
                    where: { id: company.id },
                    data: { ghlLocationId: ghlLocation.id }
                });
            }
        } catch (ghlError: any) {
            console.error(`[Stripe Webhook] GHL provisioning failed for ${email}:`, ghlError.message);
        }

        // 3. Create the Base System Setting
        const systemSetting = await prisma.system_Setting.create({
          data: {
            userId: user.id,
          },
        });

        // 3.5 Create GHL Integration record
        if (company?.ghlLocationId) {
            try {
                await prisma.integration.create({
                    data: {
                        systemSettingId: systemSetting.id,
                        provider: "GO_HIGH_LEVEL",
                        status: "CONNECTED",
                        credentials: {
                            locationId: company.ghlLocationId
                        }
                    }
                });
            } catch (e) {
                console.error("[Stripe Webhook] Failed to link GHL integration:", e);
            }
        }

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

            // 4.5 Buy a US Phone Number for the sub-account
            try {
                console.log(`[Stripe Webhook] Purchasing primary US number for ${email}`);
                const purchased = await purchaseUSPhoneNumber(subAccount.sid, subAccount.authToken);
                
                // Save it as a CallerId in the DB
                await prisma.callerId.create({
                    data: {
                        label: `Primary Line (${purchased.phoneNumber})`,
                        countryCode: "US",
                        twillioNumber: purchased.phoneNumber,
                        twillioSid: purchased.sid,
                        systemSettingId: systemSetting.id,
                        numberOfLines: 1
                    }
                });
                console.log(`[Stripe Webhook] Successfully purchased and registered ${purchased.phoneNumber} for ${email}`);
            } catch (purchaseError: any) {
                console.error(`[Stripe Webhook] Failed to purchase US number for ${email}:`, purchaseError.message);
                // Non-blocking failure
            }
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
