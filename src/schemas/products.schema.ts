import { z } from "zod"

export const createProductSchema = z.object({
    name: z.string(),
    price: z.coerce.number(),
    category: z.string(),
    description: z.string().optional(),
    thumbnail: z.string(),
    images: z.array(z.string()).optional(),
})
