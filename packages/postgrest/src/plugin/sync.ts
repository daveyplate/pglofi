import { getQuery, type QueryConfig, tokenStore } from "@pglofi/core"
import { QueryClient, QueryObserver } from "@tanstack/query-core"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"

import { getPostgrest } from "../client/postgrest"
import { applyPostgrestFilters } from "../query/include-filters"
import { buildSelectString } from "../query/select-builder"
import { transformPostgrestResponse } from "../transform/column-mapping"

const MAX_PAGE_SIZE = 100
const defaultQueryClient = new QueryClient()

/**
 * Calculate page batches to fetch all data up to the current page.
 * For example, if offset=205 and limit=5:
 * - Fetch: offset 0 limit 100, offset 100 limit 100, offset 200 limit 5, offset 205 limit 5
 * - Return only the last one (offset 205 limit 5) as the actual data
 */
function calculatePageBatches(offset: number, limit: number) {
    const batches: Array<{ offset: number; limit: number; isActual: boolean }> =
        []

    // Calculate batches for previous pages (up to but not including the actual query)
    let currentOffset = 0
    while (currentOffset < offset) {
        const batchLimit = Math.min(MAX_PAGE_SIZE, offset - currentOffset)
        batches.push({
            offset: currentOffset,
            limit: batchLimit,
            isActual: false
        })
        currentOffset += batchLimit
    }

    // Add the actual query batch
    batches.push({ offset, limit, isActual: true })

    return batches
}

export function sync(
    schema: Record<string, AnyPgTable>,
    tableKey: string,
    config?: QueryConfig<Record<string, AnyPgTable>, string>,
    queryClient?: QueryClient,
    dbURL?: string
) {
    const table = schema[tableKey]
    const tableName = getTableName(table)
    const selectString = buildSelectString(schema, tableKey, config)

    // Get the queryStore
    const queryStore = getQuery(schema, tableKey, config)

    if (!queryStore) {
        console.warn(
            `[PostgrestSync] Query store not found for table "${tableName}"`
        )
        return () => {}
    }

    const client = queryClient ?? defaultQueryClient
    client.mount()

    // Create a query key based on table and config
    const queryKey = [
        "postgrest",
        tableName,
        config ? JSON.stringify(config) : undefined
    ].filter(Boolean)

    const observer = new QueryObserver(client, {
        queryKey,
        queryFn: async () => {
            const postgrest = getPostgrest(dbURL, tokenStore.state)

            // Determine if we need to fetch multiple pages
            const offset = config?.offset ?? 0
            const limit = config?.limit ?? MAX_PAGE_SIZE

            let transformedData: unknown[]

            // If offset is 0 or undefined, just fetch normally
            if (offset === 0) {
                let queryBuilder = postgrest
                    .from(tableName)
                    .select(selectString)
                queryBuilder = applyPostgrestFilters(
                    queryBuilder,
                    config ?? {},
                    table,
                    schema
                )

                const { data, error } = await queryBuilder
                if (error) throw error

                transformedData = transformPostgrestResponse(
                    schema,
                    table,
                    data as unknown as Record<string, unknown>[],
                    config?.include
                )
            } else {
                // Calculate all page batches to fetch
                const batches = calculatePageBatches(offset, limit)

                // Fetch all batches in parallel
                const results = await Promise.all(
                    batches.map(async (batch) => {
                        const batchQuery = {
                            ...config,
                            offset: batch.offset,
                            limit: batch.limit
                        }

                        let queryBuilder = postgrest
                            .from(tableName)
                            .select(selectString)
                        queryBuilder = applyPostgrestFilters(
                            queryBuilder,
                            batchQuery,
                            table,
                            schema
                        )

                        const { data, error } = await queryBuilder
                        if (error) throw error

                        const transformedData = transformPostgrestResponse(
                            schema,
                            table,
                            data as unknown as Record<string, unknown>[],
                            config?.include
                        )

                        return {
                            data: transformedData,
                            isActual: batch.isActual
                        }
                    })
                )

                // Return only the actual query result
                const actualResult = results.find((r) => r.isActual)
                transformedData = (actualResult?.data || []) as unknown[]
            }

            return transformedData
        }
    })

    const unsubscribe = observer.subscribe((result) => {
        if (queryStore) {
            queryStore.setState((prev) => ({
                ...prev,
                remoteData: result.data,
                isPending: prev.isPending && result.isPending,
                error: result.error
            }))
        }
    })

    return () => {
        unsubscribe()
    }
}
