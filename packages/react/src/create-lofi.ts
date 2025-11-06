import {
    createLofi as createLofiCore,
    filterTableSchema,
    type LofiConfig,
    type QueryConfig,
    type TableKey,
    type TablesOnly,
    tokenStore
} from "@pglofi/core"
import { useStore } from "@tanstack/react-store"
import { useQuery as useQueryPrimitive } from "./hooks/use-query"

// Helper type to ensure no extra properties are passed
type NoExtraProperties<T, U extends T> = U & {
    [K in Exclude<keyof U, keyof T>]: never
}

export async function createLofi<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
) {
    const lofi = await createLofiCore(config)
    const sanitizedSchema = filterTableSchema(config.schema)

    function useQuery<
        TTableKey extends TableKey<TSchema>,
        TQueryConfig extends QueryConfig<TablesOnly<TSchema>, TTableKey>
    >(
        tableKey?: TTableKey | null | 0 | false | "",
        query?: NoExtraProperties<
            QueryConfig<TablesOnly<TSchema>, TTableKey>,
            TQueryConfig
        >
    ) {
        return useQueryPrimitive(
            sanitizedSchema,
            lofi.collections,
            tableKey,
            query,
            lofi.subscribeQuery
        )
    }

    return {
        ...lofi,
        useQuery,
        useToken: () => useStore(tokenStore)
    }
}
