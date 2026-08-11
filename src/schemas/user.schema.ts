import { z } from "zod"


export const createUserSchema = z.object({
    fullName: z.string().min(1, "Full name is required"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters").optional(),
    role: z.enum(["AGENT", "ADMIN", "OWNER"]).default("AGENT"),
    status: z.enum(["ACTIVE", "DEACTIVATED", "SUSPENDED", "PENDING", "EXPIRING_SOON"]).default("ACTIVE"),
    image: z.string().optional(),
    createdById: z.string().optional(),
    companyName: z.string().optional(),
    // Fields below were previously stripped by validation, causing
    // createUserInDb to fall through to "auto-select first Stripe price"
    // — which sent Scale ($497) checkout links to admins who explicitly
    // chose Starter ($97) in the UI. Confirmed live in production logs
    // (GA 4.0 audit).
    planId: z.string().optional(),
    stripeAgentSeatItemId: z.string().optional(),
    agentSeatMonthlyPriceCents: z.number().optional(),
})


export const updateUserSchema = z.object({
    fullName: z.string().optional(),
    email: z.string().email().optional(),
    role: z.enum(["AGENT", "ADMIN", "OWNER"]).optional(),
    status: z.enum(["ACTIVE", "DEACTIVATED", "SUSPENDED", "PENDING", "EXPIRING_SOON"]).optional(),
    image: z.string().optional(),
    emailVerified: z.boolean().optional(),
    defaultCallerId: z.string().optional(),
})
