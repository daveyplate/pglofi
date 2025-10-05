import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { jwt } from "better-auth/plugins"

import { db } from "@/database/db"
import * as schema from "@/database/schema"

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        usePlural: true,
        schema
    }),
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
    plugins: [jwt({ jwks: { keyPairConfig: { alg: "RS256" } } })]
})
