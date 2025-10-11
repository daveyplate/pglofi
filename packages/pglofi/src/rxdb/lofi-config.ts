import type { RxCollection } from "rxdb"

export type LofiConfig = {
    name?: string
    schema: Record<string, unknown>
    devMode?: boolean
    storage?: "localstorage" | "memory"
    enabled?: boolean
    sync?: "ably" | false | undefined | null
    ablyToken?: string
    version?: number
    migrationStrategy?: (
        tableName: string,
        version: number,
        oldDocumentData: Record<string, unknown>,
        collection: RxCollection
    ) => unknown
}
