import { createLofiHooks } from "./lofi-hooks"
import { createLofiMutators } from "./lofi-mutators"
import { usePostgrestQuery } from "./postgrest/use-postgrest-query"
import type { QueryConfig } from "./shared/lofi-query-types"
import { filterTableSchema } from "./shared/drizzle-table-filter"

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

export const createPgQuery = <TSchema extends Record<string, unknown>>(
    schema: TSchema
) => {
    const tableSchema = filterTableSchema(schema)
    function useQuery<
        TTableKey extends keyof typeof tableSchema,
        TQuery extends QueryConfig<
            typeof tableSchema,
            (typeof tableSchema)[TTableKey]
        >
    >(tableKey?: TTableKey | null | 0 | false | "", query?: TQuery) {
        return usePostgrestQuery(tableSchema, tableKey, query)
    }

    return { useQuery }
}
