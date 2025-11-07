import type { Collection } from "@tanstack/db"
import { Store } from "@tanstack/store"
import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import { isEqual } from "lodash-es"
import { addRxPlugin } from "rxdb/plugins/core"
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode"

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
    createReplications,
    type PullStreams,
    pullStreamsStore,
    type ReplicationStates,
    replicationStatesStore
} from "./database/create-replications"
import {
    configStore,
    type LofiConfig,
    receiveConfig
} from "./database/lofi-config"
import { deleteEntity, insertEntity, updateEntity } from "./mutators/mutators"
import { createQuery } from "./query/create-query"
import type { QueryConfig, StrictQueryConfig } from "./query/query-types"
import { subscribeQuery } from "./query/subscribe-query"
import {
    filterTableSchema,
    type SchemaCollections,
    type TableKey,
    type TablesOnly
} from "./utils/schema-filter"

export const tokenStore = new Store<string | undefined>(undefined)
export const syncStartedStore = new Store(false)

type CreateLofiReturn<TSchema extends Record<string, unknown>> = {
    setToken: (token?: string) => void
    startSync: () => void
    createQuery: <
        TTableKey extends TableKey<TSchema>,
        TQueryConfig extends QueryConfig<TablesOnly<TSchema>, TTableKey>
    >(
        tableKey?: TTableKey | null | 0 | false | "",
        query?: StrictQueryConfig<TablesOnly<TSchema>, TTableKey, TQueryConfig>
    ) => ReturnType<
        typeof createQuery<TablesOnly<TSchema>, TTableKey, TQueryConfig>
    >
    subscribeQuery: <
        TTableKey extends TableKey<TSchema>,
        TQueryConfig extends QueryConfig<TablesOnly<TSchema>, TTableKey>
    >(
        tableKey?: TTableKey | null | 0 | false | "",
        query?: StrictQueryConfig<TablesOnly<TSchema>, TTableKey, TQueryConfig>
    ) => () => void
    insert: <TTableKey extends TableKey<TSchema>>(
        tableKey: TTableKey,
        values: InferInsertModel<TablesOnly<TSchema>[TTableKey]>
    ) => Promise<InferSelectModel<TablesOnly<TSchema>[TTableKey]>>
    update: <TTableKey extends TableKey<TSchema>>(
        tableKey: TTableKey,
        id: string,
        fields: Partial<InferInsertModel<TablesOnly<TSchema>[TTableKey]>>
    ) => Promise<void>
    delete: <TTableKey extends TableKey<TSchema>>(
        tableKey: TTableKey,
        id: string
    ) => Promise<void>
    collections: SchemaCollections<TSchema>
    pullStreams: PullStreams<TSchema>
    replicationStates: ReplicationStates<TSchema>
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

            if (!isServer && !resolvedConfig.autoResetStorage) {
                for (const storage of db.storageInstances) {
                    await storage.remove()
                }
            }

            await createCollections(resolvedConfig, db)
        }

        // Create replications for each table
        await createReplications(resolvedConfig, db)

        // if (!isServer) {
        //     for (const tableKey in sanitizedSchema) {
        //         const schemaTable = sanitizedSchema[tableKey]
        //         const tableName = getTableName(schemaTable)

        //         if (
        //             resolvedConfig.shapeURL &&
        //             (tableName === "todos" || tableName === "profiles")
        //         ) {
        //             const pullStreams =
        //                 pullStreamsStore.state as PullStreams<TSchema>
        //             const pullStream$ = pullStreams[tableKey]

        //             if (!pullStream$) continue

        //             const stream = new ShapeStream({
        //                 url: resolvedConfig.shapeURL,
        //                 params: {
        //                     table: tableName
        //                 },
        //                 headers: tokenStore.state
        //                     ? { Authorization: `Bearer ${tokenStore.state}` }
        //                     : undefined
        //             })

        //             const shape = new Shape(stream)
        //             shape.subscribe((data) => {
        //                 pullStream$.next({
        //                     checkpoint: {},
        //                     documents: data.rows.map((row) => ({
        //                         id: String(row.id),
        //                         ...row,
        //                         _deleted: false
        //                     }))
        //                 })
        //             })
        //         }
        //     }
        // }
    }

    configStore.setState(resolvedConfig as LofiConfig<Record<string, unknown>>)

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
    const pullStreams = pullStreamsStore.state as PullStreams<TSchema>
    const replicationStates =
        replicationStatesStore.state as ReplicationStates<TSchema>

    const startSync = async () => {
        for (const tableKey in replicationStates) {
            await replicationStates[tableKey].start()
        }

        syncStartedStore.setState(true)
    }

    return {
        setToken: (token?: string) => {
            tokenStore.setState(token)

            if (token) startSync()
        },
        startSync,
        createQuery: (tableKey, query) =>
            createQuery(sanitizedSchema, collections, tableKey, query),
        subscribeQuery: (tableKey, query) =>
            subscribeQuery(
                sanitizedSchema,
                collections,
                tableKey,
                query,
                resolvedConfig.plugins
            ),
        insert: (tableKey, values) =>
            insertEntity(sanitizedSchema, collections, tableKey, values),
        update: (tableKey, id, fields) =>
            updateEntity(sanitizedSchema, collections, tableKey, id, fields),
        delete: (tableKey, id) =>
            deleteEntity(sanitizedSchema, collections, tableKey, id),
        collections,
        pullStreams,
        replicationStates
    }
}
