import type { Collection } from "@tanstack/db"
import { Store } from "@tanstack/store"
import type { RxDatabase, RxReplicationPullStreamItem } from "rxdb"
import type { RxReplicationState } from "rxdb/dist/types/plugins/replication"
import type { Subject } from "rxjs"
import type { LofiConfig } from "./database/lofi-config"

export const dbStore = new Store<RxDatabase | undefined>(undefined)

export const configStore = new Store<
    // biome-ignore lint/suspicious/noExplicitAny: any schema
    LofiConfig<any> | undefined
>(undefined)

export const tokenStore = new Store<string | undefined | null>(undefined)

export const collectionsStore: Store<Record<string, Collection>> = new Store({})

export const replicationStatesStore: Store<
    Record<string, RxReplicationState<unknown, unknown>>
> = new Store({})

export const pullStreamsStore: Store<
    Record<string, Subject<RxReplicationPullStreamItem<unknown, unknown>>>
> = new Store({})
