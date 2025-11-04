import { createLofi } from "@pglofi/core"
import * as schema from "@/database/schema"

export const lofi = await createLofi({
    schema: schema,
    storage: "memory"
})
