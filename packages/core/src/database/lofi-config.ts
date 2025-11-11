import type { RxCollection, RxStorage } from "rxdb"
import type { LofiPlugin } from "../plugin/lofi-plugin"

export type LofiConfig<TSchema extends Record<string, unknown>> = {
    name?: string
    schema: TSchema
    devMode?: boolean
    autoStart?: boolean
    storage?: "localstorage" | "memory" | "dexie" | RxStorage<unknown, unknown>
    version?: number
    plugins?: LofiPlugin[]
    token?: string
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
    return {
        devMode: process.env.NODE_ENV === "development",
        name: "pglofi",
        version: 0,
        autoStart: true,
        ...config
    }
}
