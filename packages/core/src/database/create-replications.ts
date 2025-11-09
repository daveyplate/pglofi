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
                handler: async () => {
                    return []
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
