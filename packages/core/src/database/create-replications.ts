import type { RxDatabase, RxReplicationPullStreamItem } from "rxdb"
import {
    type RxReplicationState,
    replicateRxCollection
} from "rxdb/plugins/replication"
import { Subject } from "rxjs"

import { pullStreamsStore, replicationStatesStore } from "../stores"
import {
    filterTableSchema,
    type TableKey,
    type TablesOnly
} from "../utils/schema-filter"
import type { LofiConfig } from "./lofi-config"

export type PullStreams<TSchema extends Record<string, unknown>> = Record<
    TableKey<TSchema>,
    Subject<RxReplicationPullStreamItem<unknown, unknown>>
>

export type ReplicationStates<TSchema extends Record<string, unknown>> = Record<
    TableKey<TSchema>,
    RxReplicationState<unknown, unknown>
>

export async function createReplications<
    TSchema extends Record<string, unknown>
>(config: LofiConfig<TSchema>, db: RxDatabase) {
    const isServer = typeof window === "undefined"

    if (isServer) {
        return
    }

    const sanitizedSchema = filterTableSchema(
        config.schema
    ) as TablesOnly<TSchema>
    const schemaTableKeys = Object.keys(sanitizedSchema) as TableKey<TSchema>[]

    const pullStreams = {} as PullStreams<TSchema>
    const replicationStates = {} as ReplicationStates<TSchema>

    for (const tableKey of schemaTableKeys) {
        if (!(tableKey in db.collections)) continue

        const pullStream$ = new Subject<
            RxReplicationPullStreamItem<unknown, unknown>
        >()
        pullStreams[tableKey] = pullStream$

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

        replicationStates[tableKey] = replicationState
    }

    pullStreamsStore.setState(
        pullStreams as Record<
            string,
            Subject<RxReplicationPullStreamItem<unknown, unknown>>
        >
    )

    replicationStatesStore.setState(
        replicationStates as Record<
            string,
            RxReplicationState<unknown, unknown>
        >
    )
}
