import { createCollection, liveQueryCollectionOptions } from "@tanstack/db"
import { type AnyUpdater, Store } from "@tanstack/store"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { SchemaCollections } from "../utils/schema-filter"
import { buildQuery, flatToHierarchical } from "./query-builder"
import type { InferQueryResult, QueryConfig } from "./query-types"

export type QueryResult<TData = unknown[]> = {
    isPending: boolean
    data: TData
    error?: Error
    refetch?: () => void
}

export type QueryStore<TData = unknown[]> = Store<
    QueryResult<TData>,
    AnyUpdater
>

// biome-ignore lint/suspicious/noExplicitAny: we need to store any[] in the map
const queryStores = new Map<string, QueryStore<any[]>>()

export function createQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    collections: SchemaCollections<TSchema>,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: TQueryConfig
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

    if (tableKey) {
        const query = buildQuery(schema, collections, tableKey, config)
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

        queryCollection.cleanup()
    }

    const store = new Store({
        isPending: !data?.length,
        data
    })

    queryStores.set(queryKey, store)

    return store
}
