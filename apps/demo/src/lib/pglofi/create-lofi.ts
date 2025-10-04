import type { AnyPgTable } from "drizzle-orm/pg-core"
import { createLofiHooks } from "./lofi-hooks"
import { createLofiMutators } from "./lofi-mutators"

export const createLofi = <TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema
) => {
    const mutators = createLofiMutators(schema)
    const hooks = createLofiHooks(schema)

    return {
        ...mutators,
        ...hooks
    }
}
