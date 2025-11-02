import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { jwt, multiSession } from "better-auth/plugins"
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
    trustedOrigins: ["http://localhost:3000", "https://*.ngrok.dev"],
    advanced: {
        database: { generateId: () => v7() }
    },
    emailAndPassword: {
        enabled: true
    },
    databaseHooks: {
        session: {
            create: {
                before: async (session) => {
                    session.token = (
                        await auth.api.signJWT({
                            body: {
                                payload: {
                                    sub: session.userId,
                                    role: "authenticated",
                                    iat: Math.floor(Date.now() / 1000),
                                    exp: Math.floor(
                                        session.expiresAt.getTime() / 1000
                                    )
                                }
                            }
                        })
                    ).token
                }
            }
        }
    },
    plugins: [
        multiSession(),
        jwt({ jwks: { keyPairConfig: { alg: "ES256" } } })
    ]
})
