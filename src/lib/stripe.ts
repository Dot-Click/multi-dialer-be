import Stripe from "stripe";
import { envConfig } from "./config";

type StripeClient = InstanceType<typeof Stripe>;

let client: StripeClient | null = null;

export function getStripeClient(): StripeClient {
  if (!client) {
    const key = envConfig.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
    client = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  }
  return client;
}
