import { useStore } from "@nanostores/react"
import { type Collection, createCollection } from "@tanstack/react-db"
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection"
import { getTableName } from "drizzle-orm"
import { differenceWith, fromPairs, isEqual, toPairs } from "lodash"
import { atom } from "nanostores"
import { useEffect } from "react"
import {
    addRxPlugin,
    createRxDatabase,
    type MigrationStrategies,
    type RxCollectionCreator,
    type RxDatabase,
    type RxReplicationPullStreamItem,
    type RxStorage
} from "rxdb"
import { RxDBLeaderElectionPlugin } from "rxdb/plugins/leader-election"
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema"
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder"
import { replicateRxCollection } from "rxdb/plugins/replication"
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage"
import { getRxStorageMemory } from "rxdb/plugins/storage-memory"
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv"
import { type Observable, Subject } from "rxjs"
import { getPostgrest } from "../postgrest/postgrest"
import {
    transformSqlRowsToTs,
    transformTsToSql
} from "../shared/column-mapping"
import { filterTableSchema } from "../shared/schema-helpers"
import { $lofiConfig, type LofiConfig } from "./lofi-config"

addRxPlugin(RxDBMigrationSchemaPlugin)
addRxPlugin(RxDBQueryBuilderPlugin)
addRxPlugin(RxDBLeaderElectionPlugin)

export const $lofiDb = atom<RxDatabase | null>(null)

export const $tableCollections = atom<
    Record<string, Collection<object, string>>
>({})

export let pullStreams: Record<string, Subject<unknown>> = {}

export const sendToPullStream = (
    table: string,
    {
        checkpoint,
        documents
    }: { checkpoint: unknown; documents: Record<string, unknown>[] }
) => {
    const db = $lofiDb.get()
    if (!db) throw new Error("Database not initialized")

    // Always convert IDs to strings before storing in RxDB
    const mappedDocuments = documents.map(({ id, ...rest }) => {
        return {
            id: `${id}`,
            ...rest
        }
    })

    if (db.isLeader()) {
        pullStreams[table].next({ checkpoint, documents: mappedDocuments })
    } else {
        db.leaderElector().broadcastChannel.postMessage({
            type: "pull-stream",
            payload: {
                table,
                value: { checkpoint, documents: mappedDocuments }
            }
        })
    }
}

// Clean up existing database
async function destroyDatabase() {
    const db = $lofiDb.get()
    if (!db) return

    await db.close()
    pullStreams = {}

    Object.values($tableCollections.get()).forEach((collection) => {
        collection.cleanup()
    })

    $tableCollections.set({})
    $lofiDb.set(null)
}

export async function initializeDb(
    userConfig: Omit<LofiConfig, "schema"> & { schema: Record<string, unknown> }
) {
    const sanitizedSchema = filterTableSchema(userConfig.schema)

    const config = {
        enabled: true,
        ...userConfig,
        schema: sanitizedSchema
    }

    if (config.devMode === undefined) {
        config.devMode = process.env.NODE_ENV === "development"
    }

    if (config.ablyToken === undefined) {
        config.ablyToken = process.env.NEXT_PUBLIC_ABLY_API_KEY
    }

    if (config.storage === undefined) {
        config.storage = "memory"
    }

    if (config.dbURL === undefined) {
        config.dbURL = process.env.NEXT_PUBLIC_NEON_DATA_API_URL
    }

    if (config.devMode) {
        await import("rxdb/plugins/dev-mode").then((module) =>
            addRxPlugin(module.RxDBDevModePlugin)
        )
    }

    const currentConfig = $lofiConfig.get()

    // Check if config has changed
    if (
        currentConfig?.name !== config.name ||
        !isEqual(currentConfig?.schema, config.schema) ||
        currentConfig?.storage !== config.storage ||
        currentConfig?.version !== config.version ||
        !isEqual(currentConfig?.migrationStrategy, config.migrationStrategy)
    ) {
        await destroyDatabase()
    }

    $lofiConfig.set(config)

    // Only proceed if enabled is true
    if (!config.enabled) return

    if ($lofiDb.get()) return

    const db = await createDatabase()
    $lofiDb.set(db)
}

async function createDatabase(): Promise<RxDatabase> {
    const config = $lofiConfig.get()

    if (!config) throw new Error("Config not found")

    const { name, schema, storage, version, migrationStrategy, onPushError } =
        config

    const db = await createRxDatabase({
        name:
            name ??
            window.location.hostname.replace(/[^a-z0-9]/gi, "_").toLowerCase(),
        storage: wrappedValidateAjvStorage({
            storage: (storage === "localstorage"
                ? getRxStorageLocalstorage()
                : getRxStorageMemory()) as RxStorage<unknown, unknown>
        }),
        multiInstance: storage !== "memory",
        closeDuplicates: true
    })

    const schemaTableKeys = Object.keys(schema) as (keyof typeof schema)[]
    const collections = {} as Record<string, RxCollectionCreator>

    schemaTableKeys.forEach((tableKey) => {
        const schemaTable = schema[tableKey]
        const tableName = getTableName(schemaTable)

        collections[tableName] = {
            schema: {
                title: tableName,
                version: version ?? 0,
                type: "object",
                primaryKey: "id",
                properties: {
                    id: { type: "string", maxLength: 100 },
                    isPending: { type: "boolean" },
                    xmin: { type: "string" }
                },
                required: ["id"]
            }
        }

        const migrationStrategies: MigrationStrategies = {}

        for (let i = 0; i < (version ?? 0); i++) {
            migrationStrategies[i + 1] = (oldDocumentData, collection) => {
                if (migrationStrategy) {
                    return migrationStrategy(
                        tableName,
                        i + 1,
                        oldDocumentData,
                        collection
                    )
                }

                return oldDocumentData
            }
        }

        collections[tableName].migrationStrategies = migrationStrategies

        const columns = Object.keys(schemaTable) as (
            | keyof typeof schemaTable
            | "id"
        )[]
        columns.forEach((column) => {
            if (column === "id") return

            const tableColumn = schemaTable[column] as {
                dataType?: string
                notNull?: boolean
                sqlName?: string
            }

            if (!tableColumn.dataType) return

            const isNullable = !tableColumn.notNull

            if (
                tableColumn.dataType === "date" ||
                tableColumn.sqlName === "citext"
            ) {
                collections[tableName].schema.properties[column] = isNullable
                    ? {
                          anyOf: [
                              {
                                  type: "string"
                              },
                              { type: "null" }
                          ]
                      }
                    : {
                          type: "string"
                      }
            } else if (tableColumn.dataType === "json") {
                collections[tableName].schema.properties[column] = isNullable
                    ? {
                          anyOf: [{ type: "object" }, { type: "null" }]
                      }
                    : {
                          type: "object"
                      }
            } else {
                collections[tableName].schema.properties[column] = isNullable
                    ? {
                          anyOf: [
                              { type: tableColumn.dataType },
                              { type: "null" }
                          ]
                      }
                    : {
                          type: tableColumn.dataType
                      }
            }

            if (tableColumn.notNull) {
                collections[tableName].schema.required = [
                    ...collections[tableName].schema.required!,
                    column
                ]
            }
        })
    })

    await db.addCollections(collections)

    db.waitForLeadership().then(() => {
        db.leaderElector().broadcastChannel.onmessage = (event) => {
            if (event.type === "pull-stream") {
                pullStreams[event.payload.table].next(event.payload.value)
            }
        }
    })

    for (const tableKey of schemaTableKeys) {
        const tableName = getTableName(schema[tableKey])
        const schemaTable = schema[tableKey]

        const tableCollection = createCollection(
            rxdbCollectionOptions({
                rxCollection: db[tableName],
                startSync: true
            })
        )

        $tableCollections.set({
            ...$tableCollections.get(),
            [tableName]: tableCollection
        })

        const pullStream$ = new Subject()

        pullStreams[tableName] = pullStream$

        const leaderReplicationState = replicateRxCollection({
            replicationIdentifier: tableName,
            collection: db[tableName],
            autoStart: true,
            waitForLeadership: true,
            push: {
                async handler(changeRows) {
                    const postgrest = getPostgrest()

                    const conflicts = []

                    for (const changeRow of changeRows) {
                        if (changeRow.newDocumentState._deleted) {
                            const { error } = await postgrest
                                .from(tableName)
                                .delete()
                                .eq("id", changeRow.newDocumentState.id)

                            if (error) {
                                if (!error.code) throw error

                                if (onPushError) {
                                    onPushError({
                                        table: tableName,
                                        operation: "delete",
                                        document: changeRow.newDocumentState,
                                        error
                                    })
                                } else {
                                    console.error(error)
                                }
                                conflicts.push(changeRow.assumedMasterState)
                            }
                        } else {
                            if (changeRow.assumedMasterState) {
                                const changes = differenceWith(
                                    toPairs(changeRow.newDocumentState),
                                    toPairs(changeRow.assumedMasterState),
                                    isEqual
                                )

                                const update = fromPairs(changes)

                                delete update._deleted
                                delete update.isPending

                                // Transform TypeScript property names to SQL column names
                                const sqlUpdate = transformTsToSql(
                                    schemaTable,
                                    update
                                )

                                const { data, error } = await postgrest
                                    .from(tableName)
                                    .update(sqlUpdate)
                                    .eq("id", changeRow.newDocumentState.id)
                                    .select("*,xmin")

                                if (error) {
                                    if (!error.code) throw error

                                    if (onPushError) {
                                        onPushError({
                                            table: tableName,
                                            operation: "update",
                                            document:
                                                changeRow.newDocumentState,
                                            error
                                        })
                                    } else {
                                        console.error({ error })
                                    }
                                    conflicts.push(changeRow.assumedMasterState)

                                    continue
                                }

                                // Transform SQL column names back to TypeScript property names
                                const transformedData = transformSqlRowsToTs(
                                    schemaTable,
                                    data
                                )

                                sendToPullStream(tableName, {
                                    checkpoint: {},
                                    documents: transformedData
                                })
                            } else {
                                const insert = {
                                    ...changeRow.newDocumentState
                                }

                                delete insert._deleted
                                delete insert.isPending

                                // Transform TypeScript property names to SQL column names
                                const sqlInsert = transformTsToSql(
                                    schemaTable,
                                    insert
                                )

                                const { data, error } = await postgrest
                                    .from(tableName)
                                    .upsert(sqlInsert, {
                                        onConflict: "id"
                                    })
                                    .select("*,xmin")

                                if (error) {
                                    if (!error.code) throw error

                                    if (onPushError) {
                                        onPushError({
                                            table: tableName,
                                            operation: "insert",
                                            document:
                                                changeRow.newDocumentState,
                                            error
                                        })
                                    } else {
                                        console.error({ error })
                                    }
                                    conflicts.push({
                                        ...changeRow.newDocumentState,
                                        _deleted: true
                                    })

                                    continue
                                }

                                // Transform SQL column names back to TypeScript property names
                                const transformedData = transformSqlRowsToTs(
                                    schemaTable,
                                    data
                                )

                                sendToPullStream(tableName, {
                                    checkpoint: {},
                                    documents: transformedData
                                })
                            }
                        }
                    }

                    return conflicts
                }
            },
            pull: {
                handler: async () => {
                    return {
                        checkpoint: {},
                        documents: []
                    }
                },
                stream$: pullStream$.asObservable() as Observable<
                    RxReplicationPullStreamItem<object, unknown>
                >
            }
        })

        leaderReplicationState.error$.subscribe(console.error)
    }

    return db
}

export function useDb() {
    return useStore($lofiDb)
}

export function useLofiConfig() {
    return useStore($lofiConfig)
}

export function useInitializeDb(
    config: Omit<LofiConfig, "schema"> & { schema: Record<string, unknown> }
) {
    useEffect(() => {
        initializeDb(config)
    }, [config])
}
