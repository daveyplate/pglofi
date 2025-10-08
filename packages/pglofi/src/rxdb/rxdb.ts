import { type Collection, createCollection } from "@tanstack/react-db"
import { getTableName } from "drizzle-orm"
import { useEffect, useSyncExternalStore } from "react"
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
import { rxdbCollectionOptions } from "../rxdb-db-collection/rxdb"

addRxPlugin(RxDBMigrationSchemaPlugin)
addRxPlugin(RxDBQueryBuilderPlugin)
addRxPlugin(RxDBLeaderElectionPlugin)

import { postgrest } from "../postgrest/postgrest"
import {
    transformSqlRowsToTs,
    transformTsToSql
} from "../shared/column-mapping"
import { notify, subscribe } from "../shared/subscriptions"
import type { LofiConfig } from "./lofi-config"

let lofiConfig: LofiConfig | null = null
export let rxDb: RxDatabase | null = null

export let tableCollections: Record<string, Collection<object, string>> = {}

export let pullStreams: Record<string, Subject<unknown>> = {}

export const sendToPullStream = (
    table: string,
    {
        checkpoint,
        documents
    }: { checkpoint: unknown; documents: Record<string, unknown>[] }
) => {
    if (!rxDb) throw new Error("Database not initialized")

    // Always convert IDs to strings before storing in RxDB
    const mappedDocuments = documents.map(({ id, ...rest }) => {
        return {
            id: `${id}`,
            ...rest
        }
    })

    if (rxDb.isLeader()) {
        pullStreams[table].next({ checkpoint, documents: mappedDocuments })
    } else {
        rxDb.leaderElector().broadcastChannel.postMessage({
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
    if (!rxDb) return

    notify("lofi:db", null)
    await rxDb.close()
    pullStreams = {}

    Object.values(tableCollections).forEach((collection) => {
        collection.cleanup()
    })

    tableCollections = {}
    rxDb = null
}

export async function initializeDb(config: LofiConfig) {
    if (config.devMode === undefined) {
        config.devMode = process.env.NODE_ENV === "development"
    }

    if (config.ablyToken === undefined) {
        config.ablyToken = process.env.NEXT_PUBLIC_ABLY_API_KEY
    }

    // Check if config has changed
    if (
        !lofiConfig ||
        JSON.stringify({ ...lofiConfig, schema: undefined }) !==
            JSON.stringify({ ...config, schema: undefined }) ||
        lofiConfig.schema !== config.schema
    ) {
        await destroyDatabase()
        lofiConfig = config
        notify("lofi:config", config)
    }

    // Only proceed if enabled is true
    if (!config.enabled) return

    if (rxDb) return

    rxDb = await createDatabase(config)
    notify("lofi:db", rxDb)
}

async function createDatabase({
    name,
    schema,
    devMode,
    storage,
    version,
    migrationStrategy
}: LofiConfig): Promise<RxDatabase> {
    if (devMode) {
        await import("rxdb/plugins/dev-mode").then((module) =>
            addRxPlugin(module.RxDBDevModePlugin)
        )
    }

    const db = await createRxDatabase({
        name: name ?? window.location.hostname,
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
                    isPending: { type: "boolean" }
                },
                required: ["id"]
            }
        }

        const migrationStrategies: MigrationStrategies = {}

        for (let i = 0; i < (version ?? 0); i++) {
            migrationStrategies[i + 1] = (oldDoc, collection) => {
                if (migrationStrategy) {
                    return migrationStrategy(
                        tableName,
                        i + 1,
                        oldDoc,
                        collection
                    )
                }

                return oldDoc
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

        tableCollections[tableName] = tableCollection

        const pullStream$ = new Subject()

        pullStreams[tableName] = pullStream$

        const leaderReplicationState = replicateRxCollection({
            replicationIdentifier: tableName,
            collection: db[tableName],
            autoStart: true,
            waitForLeadership: true,
            push: {
                async handler(changeRows) {
                    const conflicts = []

                    for (const changeRow of changeRows) {
                        const { data: realMasterState, error } = await postgrest
                            .from(tableName)
                            .select("*")
                            .eq("id", changeRow.newDocumentState.id)
                            .maybeSingle()

                        if (error) {
                            if (!error.code) throw error

                            conflicts.push(changeRow.assumedMasterState)
                            continue
                        }

                        // Transform SQL column names to TypeScript property names
                        const transformedMasterState = realMasterState
                            ? transformSqlRowsToTs(schemaTable, [
                                  realMasterState
                              ])[0]
                            : null

                        if (
                            (transformedMasterState &&
                                !changeRow.assumedMasterState) ||
                            (transformedMasterState &&
                                changeRow.assumedMasterState &&
                                /*
                                 * For simplicity we detect conflicts on the server by only compare the updateAt value.
                                 * In reality you might want to do a more complex check or do a deep-equal comparison.
                                 */
                                new Date(
                                    (
                                        transformedMasterState as Record<
                                            string,
                                            unknown
                                        >
                                    ).updatedAt as string
                                ).getTime() !==
                                    new Date(
                                        changeRow.assumedMasterState.updatedAt
                                    ).getTime())
                        ) {
                            // we have a conflict
                            conflicts.push(transformedMasterState)
                            console.log(
                                "conflict",
                                transformedMasterState,
                                changeRow.assumedMasterState
                            )
                        } else {
                            if (changeRow.newDocumentState._deleted) {
                                const { error } = await postgrest
                                    .from(tableName)
                                    .delete()
                                    .eq("id", changeRow.newDocumentState.id)

                                if (error) {
                                    if (!error.code) throw error

                                    conflicts.push(transformedMasterState)
                                }
                            } else {
                                const update = {
                                    ...changeRow.newDocumentState
                                }

                                delete update._deleted
                                delete update.isPending

                                // Transform TypeScript property names to SQL column names
                                const sqlUpdate = transformTsToSql(
                                    schemaTable,
                                    update
                                )

                                const { data, error } = await postgrest
                                    .from(tableName)
                                    .upsert(sqlUpdate, {
                                        onConflict: "id"
                                    })

                                if (error) {
                                    if (!error.code) throw error

                                    conflicts.push(transformedMasterState)
                                }

                                // Transform SQL column names back to TypeScript property names
                                const transformedData = transformSqlRowsToTs(
                                    schemaTable,
                                    data || []
                                )

                                sendToPullStream(tableName, {
                                    checkpoint: {},
                                    documents:
                                        transformedData as unknown as Record<
                                            string,
                                            unknown
                                        >[]
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
    const getSnapshot = () => rxDb

    const subscribeToDb = (callback: () => void) => {
        return subscribe("lofi:db", callback)
    }

    return useSyncExternalStore(subscribeToDb, getSnapshot, getSnapshot)
}

export function getLofiConfig() {
    return lofiConfig
}

export function useLofiConfig() {
    const getSnapshot = () => lofiConfig

    const subscribeToConfig = (callback: () => void) => {
        return subscribe("lofi:config", callback)
    }

    return useSyncExternalStore(subscribeToConfig, getSnapshot, getSnapshot)
}

export function useInitializeDb(config: LofiConfig) {
    useEffect(() => {
        initializeDb(config)
    }, [config])
}
