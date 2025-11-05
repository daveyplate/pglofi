import { createCollection, liveQueryCollectionOptions } from "@tanstack/db"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { SchemaCollections } from "../utils/schema-filter"
import { createQuery } from "./create-query"
import { buildQuery, flatToHierarchical } from "./query-builder"
import type { InferQueryResult, QueryConfig } from "./query-types"

export function subscribeQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    collections: SchemaCollections<TSchema>,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: TQueryConfig
) {
    if (!tableKey) return () => {}

    const queryStore = createQuery(schema, collections, tableKey, config)
    const tableName = getTableName(schema[tableKey])

    // Build the query
    const query = buildQuery(schema, collections, tableKey, config)

    // Create the query collection
    const queryCollection = createCollection(
        liveQueryCollectionOptions({
            query,
            startSync: true
        })
    )

    // Helper function to update the store with collection data
    const updateStore = () => {
        // Get the raw data from the collection
        const rawData = queryCollection.toArray

        // Transform flat joined results into hierarchical structure
        const hierarchicalData = flatToHierarchical(
            schema,
            rawData,
            tableKey,
            tableName!,
            config
        )

        // Update the store with the new data
        queryStore.setState((prev) => ({
            ...prev,
            isPending: !hierarchicalData.length,
            data: hierarchicalData as InferQueryResult<
                TSchema,
                TTableKey,
                TQueryConfig
            >[]
        }))
    }

    queryCollection.onFirstReady(updateStore)
    const subscription = queryCollection.subscribeChanges(updateStore)

    queryCollection.startSyncImmediate()

    return () => {
        subscription.unsubscribe()
        queryCollection.cleanup()
    }
}
