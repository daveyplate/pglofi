import { addRxPlugin, createRxDatabase } from "rxdb/plugins/core"
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode"
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie"
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage"
import { getRxStorageMemory } from "rxdb/plugins/storage-memory"
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv"

import type { LofiConfig } from "./lofi-config"

export async function createDatabase<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
) {
    const isServer = typeof window === "undefined"
    const { storage, devMode, name } = config

    if (devMode) {
        addRxPlugin(RxDBDevModePlugin)
    }

    const storageInstance =
        isServer || storage === "memory"
            ? getRxStorageMemory()
            : storage === "localstorage"
              ? getRxStorageLocalstorage()
              : storage === "dexie"
                ? getRxStorageDexie()
                : storage!

    return await createRxDatabase({
        name: name!,
        closeDuplicates: true,
        storage: devMode
            ? wrappedValidateAjvStorage({
                  storage: storageInstance
              })
            : storageInstance
    })
}
