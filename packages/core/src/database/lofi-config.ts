import { Store } from "@tanstack/store"
import type { RxCollection, RxStorage } from "rxdb"
import type { LofiPlugin } from "../plugin/lofi-plugin"
import type { TablesOnly } from "../utils/schema-filter"

export const configStore = new Store<
    LofiConfig<Record<string, unknown>> | undefined
>(undefined)

export type LofiConfig<TSchema extends Record<string, unknown>> = {
    name?: string
    schema: TSchema
    devMode?: boolean
    autoStart?: boolean
    storage?: "localstorage" | "memory" | "dexie" | RxStorage<unknown, unknown>
    shapeURL?: string
    token?: string
    autoResetStorage?: boolean
    version?: number
    plugins?: LofiPlugin<TablesOnly<TSchema>>[]
    migrationStrategy?: (
        table: string,
        version: number,
        oldDocumentData: Record<string, unknown>,
        collection: RxCollection
    ) => unknown
}

export function receiveConfig<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
): LofiConfig<TSchema> {
    if (typeof window === "undefined") {
        return {
            devMode: process.env.NODE_ENV === "development",
            name: "pglofi",
            version: 0,
            ...config
        }
    }

    return {
        devMode: process.env.NODE_ENV === "development",
        storage: "memory",
        shapeURL: `${window.location.origin}/api/shape`,
        version: 0,
        name: window.location.hostname
            .replace(/[^a-z0-9]/gi, "_")
            .toLowerCase(),
        ...config
    }
}
