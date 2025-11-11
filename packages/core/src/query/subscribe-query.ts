import { createCollection, liveQueryCollectionOptions } from "@tanstack/db"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { LofiPlugin } from "../plugin/lofi-plugin"
import { dbStore } from "../stores"
import { createQuery } from "./create-query"
import { pushToPullStreams } from "./pullstream-helpers"
import { buildQuery, flatToHierarchical } from "./query-builder"
import type {
    InferQueryResult,
    QueryConfig,
    StrictQueryConfig
} from "./query-types"

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
