import {
    type Collection,
    createCollection,
    liveQueryCollectionOptions
} from "@tanstack/db"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { isEqual } from "lodash-es"

import type { LofiPlugin } from "../plugin/lofi-plugin"
import { dbStore } from "../stores"
import { createQuery } from "./create-query"
import { pushToPullStreams } from "./pullstream-helpers"
import { buildQuery, flatToHierarchical } from "./query-builder"
import type { QueryConfig, StrictQueryConfig } from "./query-types"

export function subscribeQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema & string,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: StrictQueryConfig<TSchema, TTableKey, TQueryConfig>,
    plugins?: LofiPlugin[]
) {
    if (!tableKey) return () => {}

    let cleanupFn: (() => void) | undefined
    let dbUnsubscribe: (() => void) | undefined

    const setupQuery = () => {
        if (!dbStore.state) return

        const queryStore = createQuery(schema, tableKey, config)
        const tableName = getTableName(schema[tableKey])

        // Build the query
        const query = buildQuery(schema, tableKey, config)

        // Create the query collection
        const queryCollection = createCollection(
            liveQueryCollectionOptions({
                query,
                startSync: true
            })
        )

        // Create a separate collection for fullData if pagination is used
        let fullDataCollection: Collection
        let fullDataSubscription: { unsubscribe: () => void } | undefined

        if (config?.offset) {
            // Build query for all pages up to current page (offset + limit)
            const fullDataConfig = {
                ...config,
                offset: 0,
                limit: config.offset + (config.limit ?? 0)
            }

            const fullDataQuery = buildQuery(schema, tableKey, fullDataConfig)
            fullDataCollection = createCollection(
                liveQueryCollectionOptions({
                    query: fullDataQuery,
                    startSync: true
                })
            )

            // Helper to update fullData
            const updateFullData = () => {
                const fullDataRaw = fullDataCollection.toArray

                const fullDataHierarchical = flatToHierarchical(
                    schema,
                    fullDataRaw,
                    tableKey,
                    tableName!,
                    fullDataConfig
                )

                queryStore.setState(
                    (prev) =>
                        ({
                            ...prev,
                            fullData: fullDataHierarchical
                        }) as typeof prev
                )
            }

            fullDataCollection.onFirstReady(updateFullData)
            fullDataSubscription =
                fullDataCollection.subscribeChanges(updateFullData)
            fullDataCollection.startSyncImmediate()
        }

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
            queryStore.setState(
                (prev) =>
                    ({
                        ...prev,
                        isPending: prev.isPending && !hierarchicalData.length,
                        data: hierarchicalData,
                        fullData: config?.offset
                            ? prev.fullData
                            : hierarchicalData
                    }) as typeof prev
            )
        }

        queryCollection.onFirstReady(updateStore)
        const subscription = queryCollection.subscribeChanges(updateStore)

        queryCollection.startSyncImmediate()

        // Watch for changes to fullRemoteData and push to pullStreams
        const remoteDataUnsubscribe = queryStore.subscribe(
            ({ prevVal, currentVal: { fullRemoteData } }) => {
                if (isEqual(prevVal.fullRemoteData, fullRemoteData)) return
                if (!fullRemoteData?.length) return

                // Push to pullStreams with includes handling
                pushToPullStreams(schema, tableKey, fullRemoteData, config)
            }
        )

        const pluginCleanups: Array<() => void> = []

        // Initialize plugins
        if (plugins && typeof tableKey === "string") {
            for (const plugin of plugins) {
                if (plugin.sync) {
                    const cleanup = plugin.sync(schema, tableKey, config)
                    pluginCleanups.push(cleanup)
                }
            }
        }

        cleanupFn = () => {
            subscription.unsubscribe()
            remoteDataUnsubscribe()
            queryCollection.cleanup()

            fullDataSubscription?.unsubscribe()
            fullDataCollection?.cleanup()

            for (const cleanup of pluginCleanups) {
                cleanup()
            }
        }
    }

    // Check if dbStore.state is already available
    if (dbStore.state) {
        setupQuery()
    } else {
        // Subscribe and wait for dbStore.state to become available
        dbUnsubscribe = dbStore.subscribe(({ currentVal }) => {
            if (currentVal) {
                setupQuery()
                dbUnsubscribe?.()
            }
        })
    }

    return () => {
        cleanupFn?.()
        dbUnsubscribe?.()
    }
}
