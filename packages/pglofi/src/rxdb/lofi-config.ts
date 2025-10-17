import type { PostgrestError } from "@supabase/postgrest-js"
import type { RxCollection } from "rxdb"

export type LofiConfig = {
    name?: string
    schema: Record<string, unknown>
    devMode?: boolean
    storage?: "localstorage" | "memory"
    enabled?: boolean
    dbURL?: string
    token?: string
    sync?: "ably" | false | undefined | null
    ablyToken?: string
    version?: number
    migrationStrategy?: (
        tableName: string,
        version: number,
        oldDocumentData: Record<string, unknown>,
        collection: RxCollection
    ) => unknown
    onPushError?: (params: {
        tableName: string
        operation: "delete" | "insert" | "update"
        document: Record<string, unknown>
        error: PostgrestError
    }) => void
}
