import { z } from "zod"


export const updateUserSchema = z.object({
    fullName: z.string().optional(),
    email: z.string().email().optional(),
    password: z.string().optional(),
    role: z.enum(["AGENT", "ADMIN", "OWNER"]).optional(),
    status: z.enum(["ACTIVE", "DEACTIVATED", "SUSPENDED", "PENDING", "EXPIRING_SOON"]).optional(),
    image: z.string().optional(),
    emailVerified: z.boolean().optional(),
})
