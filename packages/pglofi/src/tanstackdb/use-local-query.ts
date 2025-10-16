import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useMemo } from "react"
import { tableCollections, useDb } from "../rxdb/rxdb"
import type { InferQueryResult, QueryConfig } from "../shared/lofi-query-types"
import { buildLocalQuery } from "./local-query-helpers"
import { useLiveQuery } from "./useLiveQuery"

export function useLocalQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableName extends keyof TSchema,
    TQuery extends QueryConfig<TSchema, TSchema[TTableName]>
>(
    schema: TSchema,
    tableKey?: TTableName | null | 0 | false | "",
    query?: TQuery
) {
    type TQueryResult = InferQueryResult<TSchema, TTableName, TQuery>

    const tableName = tableKey ? getTableName(schema[tableKey]) : null
    const db = useDb()

    // Serialize query for stable dependency comparison
    const queryKey = useMemo(() => JSON.stringify(query), [query])

    const { data, isLoading, isReady } = useLiveQuery(
        (q) => {
            if (!db || !tableName || !tableKey) return null

            const tableCollection = tableCollections[tableName]

            // Build complete query (selector, joins, sort/limit/skip) in one pass
            const parentAlias = tableName

            const baseQuery = q.from({ [parentAlias]: tableCollection })
            return buildLocalQuery(
                schema,
                baseQuery,
                tableName,
                tableKey,
                parentAlias,
                query
                // biome-ignore lint/suspicious/noExplicitAny: Return type must match TanStack DB's QueryBuilder
            ) as any
        },
        [tableName, tableKey, db, queryKey]
    )

    return { data: data as TQueryResult[], isLoading: isLoading || !isReady }
}
