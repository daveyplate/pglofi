import type { RxCollection, RxStorage } from "rxdb"

export type LofiConfig<TSchema extends Record<string, unknown>> = {
    name?: string
    schema: TSchema
    devMode?: boolean
    storage?: "localstorage" | "memory" | "dexie" | RxStorage<unknown, unknown>
    shapeURL?: string
    token?: string
    version?: number
    migrationStrategy?: (
        table: string,
        version: number,
        oldDocumentData: Record<string, unknown>,
        collection: RxCollection
    ) => unknown
}
