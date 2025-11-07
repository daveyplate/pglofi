import { createCollection, liveQueryCollectionOptions } from "@tanstack/db"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { syncStartedStore } from "../create-lofi"
import type { LofiPlugin } from "../plugin/lofi-plugin"
import type { SchemaCollections } from "../utils/schema-filter"
import { createQuery } from "./create-query"
import { pushToPullStreams } from "./pullstream-helpers"
import { buildQuery, flatToHierarchical } from "./query-builder"
import type { InferQueryResult, QueryConfig, StrictQueryConfig } from "./query-types"

export function subscribeQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    collections: SchemaCollections<TSchema>,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: StrictQueryConfig<TSchema, TTableKey, TQueryConfig>,
    plugins?: LofiPlugin<TSchema>[]
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
            isPending: prev.isPending && !hierarchicalData.length,
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

    // Watch for changes to remoteData and push to pullStreams
    const remoteDataUnsubscribe = queryStore.subscribe(
        ({ prevVal, currentVal: { remoteData } }) => {
            if (prevVal.remoteData === remoteData) return
            if (!remoteData?.length) return

            // Push to pullStreams with includes handling
            pushToPullStreams(schema, tableKey, remoteData, config)
        }
    )

    const pluginCleanups: Array<() => void> = []

    // Helper function to initialize plugins
    const initializePlugins = () => {
        if (!plugins) return

        for (const plugin of plugins) {
            if (plugin.sync) {
                const cleanup = plugin.sync(schema, tableKey, config)
                pluginCleanups.push(cleanup)
            }
        }
    }

    // Subscribe to syncStartedStore and initialize plugins when sync starts
    let syncStartedUnsubscribe: (() => void) | undefined
    if (plugins) {
        // Check if sync has already started
        if (syncStartedStore.state) {
            initializePlugins()
        } else {
            // Subscribe and wait for sync to start
            syncStartedUnsubscribe = syncStartedStore.subscribe(
                ({ currentVal }) => {
                    if (currentVal) {
                        initializePlugins()
                        // Unsubscribe after initialization since we only need to run once
                        syncStartedUnsubscribe?.()
                        syncStartedUnsubscribe = undefined
                    }
                }
            )
        }
    }

    return () => {
        subscription.unsubscribe()
        remoteDataUnsubscribe()
        queryCollection.cleanup()

        if (syncStartedUnsubscribe) {
            syncStartedUnsubscribe()
        }

        for (const cleanup of pluginCleanups) {
            cleanup()
        }
    }
}
