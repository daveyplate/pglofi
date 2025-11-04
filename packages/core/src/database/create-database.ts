import { Store } from "@tanstack/store"
import {
    createRxDatabase,
    type RxDatabase,
    removeRxDatabase
} from "rxdb/plugins/core"
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie"
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage"
import { getRxStorageMemory } from "rxdb/plugins/storage-memory"
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv"
import { collectionsStore } from "./create-collections"
import { configStore, type LofiConfig } from "./lofi-config"

export const dbStore = new Store<RxDatabase | undefined>(undefined)

export async function createDatabase<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
) {
    const isServer = typeof window === "undefined"
    const { storage, devMode, name } = config

    const storageInstance =
        isServer || storage === "memory"
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
    collectionsStore.setState({})
}
