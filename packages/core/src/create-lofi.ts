import { Shape, ShapeStream } from "@electric-sql/client"
import { Store } from "@tanstack/store"
import { getTableName } from "drizzle-orm"
import type { RxReplicationPullStreamItem } from "rxdb/plugins/core"
import { replicateRxCollection } from "rxdb/plugins/replication"
import { Subject } from "rxjs"

import { createCollections } from "./database/create-collections"
import { createDatabase } from "./database/create-database"
import { type LofiConfig, receiveConfig } from "./database/lofi-config"
import { createQuery } from "./query/create-query"
import type { QueryConfig } from "./query/query-types"
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
    collections: SchemaCollections<TSchema>
    pullStreams: PullStreams<TSchema>
    syncStarted: boolean
}

export async function createLofi<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
): Promise<CreateLofiReturn<TSchema>> {
    const isServer = typeof window === "undefined"
    const resolvedConfig = receiveConfig(config)

    if (resolvedConfig.autoStart) {
        syncStartedStore.setState(true)
    }

    const db = await createDatabase(resolvedConfig)

    // TODO only clear these if there's an error
    if (!isServer && resolvedConfig.autoResetStorage) {
        db.storageInstances.forEach((storage) => {
            storage.remove()
        })
    }

    const { collections } = await createCollections(resolvedConfig, db)

    // Create pull streams for each table

    const pullStreams = {} as PullStreams<TSchema>
    const sanitizedSchema = filterTableSchema(resolvedConfig.schema)

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

    return {
        setToken: (token: string) => {
            tokenStore.setState(token)
        },
        startSync: () => {
            syncStartedStore.setState(true)
        },
        createQuery: (tableKey, query) =>
            createQuery(sanitizedSchema, collections, tableKey, query),
        collections,
        pullStreams,
        syncStarted: syncStartedStore.state
    }
}
