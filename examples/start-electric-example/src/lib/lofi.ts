import { postgrestSync } from "@pglofi/postgrest"
import { createLofi } from "@pglofi/react"
import * as schema from "@/database/schema"

export const lofi = await createLofi({
    schema: schema,
    storage: "memory",
    plugins: [postgrestSync()]
})
