import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { v7 } from "uuid"

import { db } from "@/database/db"
import * as schema from "@/database/schema"

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        usePlural: true,
        camelCase: true,
        schema
    }),
    advanced: {
        database: { generateId: () => v7() }
    },
    emailAndPassword: {
        enabled: true
    }
})
