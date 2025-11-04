import { createCollection, liveQueryCollectionOptions } from "@tanstack/db"
import { type AnyUpdater, Store } from "@tanstack/store"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { SchemaCollections } from "../utils/schema-filter"
import { buildQuery } from "./query-builder"
import type { QueryConfig } from "./query-types"

export type QueryResult = {
    isPending: boolean
    data?: unknown[] | null
    error?: Error
    refetch?: () => void
}

export type QueryStore = Store<QueryResult, AnyUpdater>

const queryStores = new Map<string, QueryStore>()

export function createStore<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQuery extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    collections: SchemaCollections<TSchema>,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: TQuery
): QueryStore {
    const tableName = tableKey ? getTableName(schema[tableKey]) : null
    const queryKey = tableName
        ? `pglofi:${tableName}:${JSON.stringify(config)}`
        : `pglofi:default`

    if (queryStores.has(queryKey)) {
        return queryStores.get(queryKey) as QueryStore
    }

    let data: unknown[] | undefined
    if (tableKey) {
        const query = buildQuery(schema, collections, tableKey, config)
        const queryCollection = createCollection(
            liveQueryCollectionOptions({
                query,
                startSync: true
            })
        )

        data = queryCollection.toArray

        queryCollection.cleanup()
    }

    const store = new Store<QueryResult, AnyUpdater>({
        isPending: !data,
        data
    })

    queryStores.set(queryKey, store)

    return store
}
