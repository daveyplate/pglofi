import { addRxPlugin } from "rxdb"
import { createRxDatabase, removeRxDatabase } from "rxdb/plugins/core"
import {
    getLeaderElectorByBroadcastChannel,
    RxDBLeaderElectionPlugin
} from "rxdb/plugins/leader-election"
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie"
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage"
import { getRxStorageMemory } from "rxdb/plugins/storage-memory"
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv"

import {
    collectionsStore,
    configStore,
    dbStore,
    pullStreamsStore,
    replicationStatesStore
} from "../stores"
import type { LofiConfig } from "./lofi-config"

export async function createDatabase<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
) {
    const { storage, devMode, name } = config

    addRxPlugin(RxDBLeaderElectionPlugin)

    const storageInstance =
        storage === "memory"
            ? getRxStorageMemory()
            : storage === "localstorage"
              ? getRxStorageLocalstorage()
              : storage === "dexie"
                ? getRxStorageDexie()
                : storage!

    const db = await createRxDatabase({
        name: name!,
        closeDuplicates: true,
        multiInstance: storage !== "memory",
        storage: devMode
            ? wrappedValidateAjvStorage({
                  storage: storageInstance
              })
            : storageInstance
    })

    const leaderElector = getLeaderElectorByBroadcastChannel(
        db.leaderElector().broadcastChannel
    )

    leaderElector.onduplicate = async () => {
        // Duplicate leader detected -> reload the page.
        location.reload()
    }

    db.waitForLeadership().then(() => {
        db.leaderElector().broadcastChannel.onmessage = (event) => {
            if (event.type === "pull-stream") {
                pullStreamsStore.state[event.payload.tableKey]?.next(
                    event.payload.value
                )
            }
        }
    })

    dbStore.setState(db)

    return db
}

export const destroyDatabase = async () => {
    await removeRxDatabase(configStore.state!.name!, dbStore.state!.storage)
    dbStore.setState(undefined)
    collectionsStore.setState({})
    pullStreamsStore.setState({})
    replicationStatesStore.setState({})
}
