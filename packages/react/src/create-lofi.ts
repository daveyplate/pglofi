import {
    createLofi as createLofiCore,
    filterTableSchema,
    type LofiConfig,
    type QueryConfig,
    type StrictQueryConfig,
    type TableKey,
    type TablesOnly,
    tokenStore
} from "@pglofi/core"
import { useStore } from "@tanstack/react-store"
import { useQuery } from "./hooks/use-query"

export async function createLofi<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
) {
    const lofi = await createLofiCore(config)
    const sanitizedSchema = filterTableSchema(config.schema)

    return {
        ...lofi,
        useQuery: <
            TTableKey extends TableKey<TSchema>,
            TQueryConfig extends QueryConfig<TablesOnly<TSchema>, TTableKey>
        >(
            tableKey?: TTableKey | null | 0 | false | "",
            query?: StrictQueryConfig<
                TablesOnly<TSchema>,
                TTableKey,
                TQueryConfig
            >
        ) => useQuery(sanitizedSchema, tableKey, query, lofi.subscribeQuery),
        useToken: () => useStore(tokenStore)
    }
}
