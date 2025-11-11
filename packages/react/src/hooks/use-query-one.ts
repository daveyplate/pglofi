import type { QueryConfig, StrictQueryConfig } from "@pglofi/core"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useMemo } from "react"
import { useQuery } from "./use-query"

export function useQueryOne<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: StrictQueryConfig<TSchema, TTableKey, TQueryConfig>,
    subscribeQuery?: (
        tableKey?: TTableKey | null | 0 | false | "",
        query?: StrictQueryConfig<TSchema, TTableKey, TQueryConfig>
    ) => () => void
) {
    const queryWithLimit = useMemo(
        () =>
            ({
                ...config,
                limit: 1
            }) as StrictQueryConfig<TSchema, TTableKey, TQueryConfig>,
        [config]
    )

    const result = useQuery(schema, tableKey, queryWithLimit, subscribeQuery)

    return {
        ...result,
        data: result.data?.[0] ?? null,
        remoteData: result.remoteData?.[0] ?? null
    }
}
