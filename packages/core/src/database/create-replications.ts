import { Store } from "@tanstack/store"
import { getTableName } from "drizzle-orm"
import type { RxDatabase, RxReplicationPullStreamItem } from "rxdb"
import { replicateRxCollection } from "rxdb/plugins/replication"
import { Subject } from "rxjs"
import {
    filterTableSchema,
    type TableKey,
    type TablesOnly
} from "../utils/schema-filter"
import type { LofiConfig } from "./lofi-config"

// biome-ignore lint/suspicious/noExplicitAny: Complex generic typing with RxDB replication
type ReplicationState = any

export type PullStreams<TSchema extends Record<string, unknown>> = Record<
    TableKey<TSchema>,
    Subject<RxReplicationPullStreamItem<unknown, unknown>>
>

export type ReplicationStates<TSchema extends Record<string, unknown>> = Record<
    TableKey<TSchema>,
    ReplicationState
>

// Add type annotation to stores to avoid inferred type warnings
export const pullStreamsStore: Store<
    Record<string, Subject<RxReplicationPullStreamItem<unknown, unknown>>>
> = new Store({})

export const replicationStatesStore: Store<Record<string, ReplicationState>> =
    new Store({})

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
        const schemaTable = sanitizedSchema[tableKey]
        const tableName = getTableName(schemaTable)

        if (!(tableName in db.collections)) continue

        const pullStream$ = new Subject<
            RxReplicationPullStreamItem<unknown, unknown>
        >()
        pullStreams[tableKey] = pullStream$

        // Set up replication for each table
        const replicationState = replicateRxCollection({
            replicationIdentifier: tableName,
            collection: db[tableName],
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

    // Store pullStreams and replicationStates in their respective stores
    pullStreamsStore.setState(
        pullStreams as Record<
            string,
            Subject<RxReplicationPullStreamItem<unknown, unknown>>
        >
    )
    replicationStatesStore.setState(
        replicationStates as Record<string, ReplicationState>
    )
}
