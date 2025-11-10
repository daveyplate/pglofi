import { postgrestPlugin } from "@pglofi/postgrest"
import { createLofi } from "@pglofi/react"
import * as schema from "@/database/schema"

export const lofi = await createLofi({
    schema: schema,
    storage: "memory",
    autoStart: false,
    plugins: [
        postgrestPlugin({
            dbURL: import.meta.env.VITE_NEON_DATA_API_URL
        })
    ]
})
