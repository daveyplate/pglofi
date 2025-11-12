import { createCollection, liveQueryCollectionOptions } from "@tanstack/db"
import { type AnyUpdater, Store } from "@tanstack/store"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { dbStore } from "../stores"
import { buildQuery, flatToHierarchical } from "./query-builder"
import type {
    InferQueryResult,
    QueryConfig,
    StrictQueryConfig
} from "./query-types"

export type QueryResult<TData = unknown[]> = {
    isPending: boolean
    data: TData
    fullData: TData | null
    remoteData: TData | null
    fullRemoteData: TData | null
    error: Error | null
    refetch?: () => void
}

export type QueryStore<TData = unknown[]> = Store<
    QueryResult<TData>,
    AnyUpdater
>

// biome-ignore lint/suspicious/noExplicitAny: we need to store any[] in the map
const queryStores = new Map<string, QueryStore<any[]>>()

export function getQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: StrictQueryConfig<TSchema, TTableKey, TQueryConfig>
):
    | QueryStore<InferQueryResult<TSchema, TTableKey, TQueryConfig>[]>
    | undefined {
    const tableName = tableKey ? getTableName(schema[tableKey]) : null
    const queryKey = tableName
        ? `pglofi:${tableName}:${JSON.stringify(config)}`
        : `pglofi:default`

    return queryStores.get(queryKey)
}

export function createQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: StrictQueryConfig<TSchema, TTableKey, TQueryConfig>
): QueryStore<InferQueryResult<TSchema, TTableKey, TQueryConfig>[]> {
    type TQueryResult = InferQueryResult<TSchema, TTableKey, TQueryConfig>[]

    const tableName = tableKey ? getTableName(schema[tableKey]) : null
    const queryKey = tableName
        ? `pglofi:${tableName}:${JSON.stringify(config)}`
        : `pglofi:default`

    if (queryStores.has(queryKey)) {
        return queryStores.get(queryKey)!
    }

    let data: TQueryResult = []
    let fullData: TQueryResult = []

    if (tableKey && dbStore.state) {
        const query = buildQuery(schema, tableKey, config)
        const queryCollection = createCollection(
            liveQueryCollectionOptions({
                query,
                startSync: true
            })
        )

        const rawData = queryCollection.toArray

        // Transform flat joined results into hierarchical structure
        const hierarchicalData = flatToHierarchical(
            schema,
            rawData,
            tableKey,
            tableName!,
            config
        )

        data = hierarchicalData as TQueryResult

        // If offset > 0, also create a collection for fullData (all pages up to current page)
        if (config?.offset) {
            const fullDataConfig = {
                ...config,
                offset: 0,
                limit: config.offset + (config?.limit ?? 0)
            }

            const fullDataQuery = buildQuery(schema, tableKey, fullDataConfig)
            const fullDataCollection = createCollection(
                liveQueryCollectionOptions({
                    query: fullDataQuery,
                    startSync: true
                })
            )

            const fullDataRaw = fullDataCollection.toArray
            const fullDataHierarchical = flatToHierarchical(
                schema,
                fullDataRaw,
                tableKey,
                tableName!,
                fullDataConfig
            )

            fullData = fullDataHierarchical as TQueryResult

            fullDataCollection.cleanup()
        } else {
            fullData = data
        }

        queryCollection.cleanup()
    }

    const store = new Store<QueryResult<TQueryResult>>({
        isPending: data.length === 0,
        data,
        fullData,
        remoteData: null,
        fullRemoteData: null,
        error: null
    })

    queryStores.set(queryKey, store)

    return store
}
