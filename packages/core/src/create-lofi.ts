import { Shape, ShapeStream } from "@electric-sql/client"
import { getTableName } from "drizzle-orm"
import type { RxReplicationPullStreamItem } from "rxdb/plugins/core"
import { replicateRxCollection } from "rxdb/plugins/replication"
import { Subject } from "rxjs"
import { createCollections } from "./database/create-collections"
import { createDatabase } from "./database/create-database"
import { type LofiConfig, receiveConfig } from "./database/lofi-config"
import { createStore as createStorePrimitive } from "./query/query-stores"
import type { QueryConfig } from "./query/query-types"
import {
    filterTableSchema,
    type SchemaCollections,
    type TableKey,
    type TablesOnly
} from "./utils/schema-filter"

let token: string | undefined
let syncStarted = false

type PullStreams<TSchema extends Record<string, unknown>> = Record<
    TableKey<TSchema>,
    Subject<RxReplicationPullStreamItem<unknown, unknown>>
>

type CreateLofiReturn<TSchema extends Record<string, unknown>> = {
    setToken: (token: string) => void
    startSync: () => void
    createStore: <
        TTableKey extends TableKey<TSchema>,
        TQuery extends QueryConfig<TablesOnly<TSchema>, TTableKey>
    >(
        tableKey?: TTableKey | null | 0 | false | "",
        query?: TQuery
    ) => ReturnType<
        typeof createStorePrimitive<TablesOnly<TSchema>, TTableKey, TQuery>
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
        syncStarted = true
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

    if (!isServer) {
        const sanitizedSchema = filterTableSchema(resolvedConfig.schema)
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
                    headers: token
                        ? { Authorization: `Bearer ${token}` }
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

    function createStore<
        TTableKey extends TableKey<TSchema>,
        TQuery extends QueryConfig<TablesOnly<TSchema>, TTableKey>
    >(tableKey?: TTableKey | null | 0 | false | "", query?: TQuery) {
        return createStorePrimitive(
            filterTableSchema(resolvedConfig.schema),
            collections,
            tableKey,
            query
        )
    }

    return {
        setToken: (_token: string) => {
            token = _token
        },
        startSync: () => {
            syncStarted = true
        },
        createStore,
        collections,
        pullStreams,
        syncStarted
    }
}
