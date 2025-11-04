import { Shape, ShapeStream } from "@electric-sql/client"
import type { Collection } from "@tanstack/db"
import { Store } from "@tanstack/store"
import { getTableName, type InferSelectModel } from "drizzle-orm"
import isEqual from "lodash/isEqual"
import {
    addRxPlugin,
    type RxReplicationPullStreamItem
} from "rxdb/plugins/core"
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode"
import { replicateRxCollection } from "rxdb/plugins/replication"
import { Subject } from "rxjs"

import {
    collectionsStore,
    createCollections
} from "./database/create-collections"
import {
    createDatabase,
    dbStore,
    destroyDatabase
} from "./database/create-database"
import {
    configStore,
    type LofiConfig,
    receiveConfig
} from "./database/lofi-config"
import { createQuery } from "./query/create-query"
import type { QueryConfig } from "./query/query-types"
import { subscribeQuery } from "./query/subscribe-query"
import {
    filterTableSchema,
    type SchemaCollections,
    type TableKey,
    type TablesOnly
} from "./utils/schema-filter"

const tokenStore = new Store<string | undefined>(undefined)
const syncStartedStore = new Store(false)

type PullStreams<TSchema extends Record<string, unknown>> = Record<
    TableKey<TSchema>,
    Subject<RxReplicationPullStreamItem<unknown, unknown>>
>

type CreateLofiReturn<TSchema extends Record<string, unknown>> = {
    setToken: (token: string) => void
    startSync: () => void
    createQuery: <
        TTableKey extends TableKey<TSchema>,
        TQueryConfig extends QueryConfig<TablesOnly<TSchema>, TTableKey>
    >(
        tableKey?: TTableKey | null | 0 | false | "",
        query?: TQueryConfig
    ) => ReturnType<
        typeof createQuery<TablesOnly<TSchema>, TTableKey, TQueryConfig>
    >
    subscribeQuery: <
        TTableKey extends TableKey<TSchema>,
        TQueryConfig extends QueryConfig<TablesOnly<TSchema>, TTableKey>
    >(
        tableKey?: TTableKey | null | 0 | false | "",
        query?: TQueryConfig
    ) => () => void
    collections: SchemaCollections<TSchema>
    // pullStreams: PullStreams<TSchema>
    syncStarted: boolean
}

export async function createLofi<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
): Promise<CreateLofiReturn<TSchema>> {
    const isServer = typeof window === "undefined"
    const resolvedConfig = receiveConfig(config)
    const sanitizedSchema = filterTableSchema(resolvedConfig.schema)

    if (resolvedConfig.autoStart) {
        syncStartedStore.setState(true)
    }

    if (!isServer && resolvedConfig.devMode) {
        addRxPlugin(RxDBDevModePlugin)
    }

    // Check if something changed in the config and destroy and recreate the db
    if (configStore.state && dbStore.state) {
        if (
            configStore.state.name !== resolvedConfig.name ||
            configStore.state.storage !== resolvedConfig.storage ||
            !isEqual(configStore.state.schema, config.schema)
        ) {
            await destroyDatabase()
        }
    }

    if (!dbStore.state) {
        const db = await createDatabase(resolvedConfig)

        try {
            await createCollections(resolvedConfig, db)
        } catch (error) {
            console.error(error)

            if (!isServer && resolvedConfig.autoResetStorage) {
                for (const storage of db.storageInstances) {
                    await storage.remove()
                }
            }

            await createCollections(resolvedConfig, db)
        }

        // Create pull streams for each table

        const pullStreams = {} as PullStreams<TSchema>

        if (!isServer) {
            const schemaTableKeys = Object.keys(
                sanitizedSchema
            ) as TableKey<TSchema>[]

            for (const tableKey of schemaTableKeys) {
                const schemaTable = sanitizedSchema[tableKey]
                const tableName = getTableName(schemaTable)

                if (!(tableName in db.collections)) continue

                const pullStream$ = new Subject<
                    RxReplicationPullStreamItem<unknown, unknown>
                >()
                pullStreams[tableKey] = pullStream$

                // Set up replication for each table
                replicateRxCollection({
                    replicationIdentifier: tableName,
                    collection: db[tableName],
                    autoStart: resolvedConfig.autoStart ?? true,
                    pull: {
                        handler: async () => {
                            return { checkpoint: {}, documents: [] }
                        },
                        stream$: pullStream$.asObservable()
                    },
                    push: {
                        handler: async () => {
                            return []
                        }
                    }
                })

                // Set up ShapeStream for each table
                if (
                    resolvedConfig.shapeURL &&
                    (tableName === "todos" || tableName === "profiles")
                ) {
                    const stream = new ShapeStream({
                        url: resolvedConfig.shapeURL,
                        params: {
                            table: tableName
                        },
                        headers: tokenStore.state
                            ? { Authorization: `Bearer ${tokenStore.state}` }
                            : undefined
                    })

                    const shape = new Shape(stream)
                    shape.subscribe((data) => {
                        // Transform data rows to match the expected format
                        pullStream$.next({
                            checkpoint: {},
                            documents: data.rows.map((row) => ({
                                id: String(row.id),
                                ...row,
                                _deleted: false
                            }))
                        })
                    })
                }
            }
        }
    }

    configStore.setState(resolvedConfig)

    // Entity type includes RxDB metadata fields
    type EntityWithMetadata<T> = T & {
        id: string
        isPending?: boolean
    }

    type CollectionsReturn = {
        [K in keyof TablesOnly<TSchema>]: Collection<
            EntityWithMetadata<InferSelectModel<TablesOnly<TSchema>[K]>>,
            string
        >
    }

    const collections = collectionsStore.state as CollectionsReturn

    return {
        setToken: (token: string) => {
            tokenStore.setState(token)
        },
        startSync: () => {
            syncStartedStore.setState(true)
        },
        createQuery: (tableKey, query) =>
            createQuery(sanitizedSchema, collections, tableKey, query),
        subscribeQuery: (tableKey, query) =>
            subscribeQuery(sanitizedSchema, collections, tableKey, query),
        collections,
        syncStarted: syncStartedStore.state
    }
}
