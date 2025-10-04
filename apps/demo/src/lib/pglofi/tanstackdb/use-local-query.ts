import { createLiveQueryCollection } from "@tanstack/react-db"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useEffect, useMemo, useState } from "react"
import { tableCollections, useDb } from "@/lib/pglofi/rxdb/rxdb"
import type { InferQueryResult, QueryConfig } from "../shared/lofi-query-types"
import { buildLocalQuery, flatToHierarchical } from "./local-query-helpers"

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
    const [data, setData] = useState<TQueryResult[]>([])
    const [isLoading, setIsLoading] = useState(true)

    // Serialize query for stable dependency comparison
    const queryKey = useMemo(() => JSON.stringify(query), [query])

    // biome-ignore lint/correctness/useExhaustiveDependencies: schema and query are intentionally excluded (see comment below)
    useEffect(() => {
        if (!db || !tableName || !tableKey) return

        const tableCollection = tableCollections[tableName]

        // Build complete query (where, joins, order/limit/offset) in one pass
        const parentAlias = tableName
        const liveQueryCollection = createLiveQueryCollection({
            startSync: true,
            query: (q) => {
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
            }
        })

        const updateData = () => {
            const flatResults = liveQueryCollection.toArray
            const hierarchicalData = flatToHierarchical(
                schema,
                flatResults,
                tableName,
                tableKey,
                parentAlias,
                query
            )
            setData(hierarchicalData as TQueryResult[])
        }

        liveQueryCollection.onFirstReady(() => {
            updateData()
            setIsLoading(false)
        })

        liveQueryCollection.subscribeChanges(() => {
            updateData()
        })
    }, [tableName, tableKey, db, queryKey])

    return { data, isLoading }
}
