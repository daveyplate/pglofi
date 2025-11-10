import { differenceWith, fromPairs, isEqual, toPairs } from "lodash-es"
import type { RxDatabase, RxReplicationPullStreamItem } from "rxdb"
import { replicateRxCollection } from "rxdb/plugins/replication"
import { Subject } from "rxjs"
import { pullStreamsStore, replicationStatesStore } from "../stores"
import { filterTableSchema, type TableKey } from "../utils/schema-filter"
import type { LofiConfig } from "./lofi-config"

export async function createReplications<
    TSchema extends Record<string, unknown>
>(config: LofiConfig<TSchema>, db: RxDatabase) {
    const sanitizedSchema = filterTableSchema(config.schema)
    const schemaTableKeys = Object.keys(sanitizedSchema) as TableKey<TSchema>[]

    for (const tableKey of schemaTableKeys) {
        if (!(tableKey in db.collections)) continue

        const pullStream$ = new Subject<
            RxReplicationPullStreamItem<unknown, unknown>
        >()

        const replicationState = replicateRxCollection({
            replicationIdentifier: tableKey as string,
            collection: db[tableKey],
            autoStart: config.autoStart ?? true,
            pull: {
                handler: async () => {
                    return { checkpoint: {}, documents: [] }
                },
                stream$: pullStream$.asObservable()
            },
            push: {
                handler: async (changeRows) => {
                    const write = config.plugins?.find(
                        (plugin) => plugin.write
                    )?.write

                    if (!write) {
                        console.warn("No write plugin found")
                        throw new Error("No write plugin found")
                    }

                    const conflicts = []

                    for (const changeRow of changeRows) {
                        if (changeRow.newDocumentState._deleted) {
                            const { result, conflict } = await write(
                                sanitizedSchema,
                                tableKey,
                                "delete",
                                changeRow.newDocumentState.id
                            )

                            if (conflict) {
                                conflicts.push(changeRow.assumedMasterState)
                            }

                            if (result || !conflict) {
                                pullStream$.next({
                                    checkpoint: {},
                                    documents: [
                                        {
                                            ...changeRow.newDocumentState,
                                            isPending: false
                                        }
                                    ]
                                })
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

                                const { result, conflict } = await write(
                                    sanitizedSchema,
                                    tableKey,
                                    "update",
                                    changeRow.newDocumentState.id,
                                    update
                                )

                                if (conflict) {
                                    conflicts.push(changeRow.assumedMasterState)
                                }

                                if (result) {
                                    pullStream$.next({
                                        checkpoint: {},
                                        documents: [
                                            {
                                                _deleted: false,
                                                _attachments: undefined,
                                                ...result
                                            }
                                        ]
                                    })
                                }
                            } else {
                                const insert = {
                                    ...changeRow.newDocumentState
                                }

                                delete insert._deleted
                                delete insert.isPending

                                const { result, conflict } = await write(
                                    sanitizedSchema,
                                    tableKey,
                                    "insert",
                                    undefined,
                                    insert
                                )

                                if (conflict) {
                                    conflicts.push(changeRow.assumedMasterState)
                                }

                                if (result) {
                                    pullStream$.next({
                                        checkpoint: {},
                                        documents: [
                                            {
                                                _deleted: false,
                                                _attachments: undefined,
                                                ...result
                                            }
                                        ]
                                    })
                                }
                            }
                        }
                    }

                    return conflicts
                }
            }
        })

        replicationStatesStore.setState((prevState) => ({
            ...prevState,
            [tableKey]: replicationState
        }))

        pullStreamsStore.setState((prevState) => ({
            ...prevState,
            [tableKey]: pullStream$
        }))
    }
}
