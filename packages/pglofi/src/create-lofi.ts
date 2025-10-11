import { createLofiHooks } from "./lofi-hooks"
import { createLofiMutators } from "./lofi-mutators"
import { filterTableSchema } from "./shared/schema-helpers"

export const createLofi = <TSchema extends Record<string, unknown>>(
    schema: TSchema
) => {
    const tableSchema = filterTableSchema(schema)

    const mutators = createLofiMutators(tableSchema)
    const hooks = createLofiHooks(tableSchema)

    return {
        ...mutators,
        ...hooks
    }
}
