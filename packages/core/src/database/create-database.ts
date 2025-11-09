import { createRxDatabase, removeRxDatabase } from "rxdb/plugins/core"
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
        storage: devMode
            ? wrappedValidateAjvStorage({
                  storage: storageInstance
              })
            : storageInstance
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
