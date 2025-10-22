import type { PostgrestError } from "@supabase/postgrest-js"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { atom } from "nanostores"
import type { RxCollection, RxStorage } from "rxdb"

export type LofiConfig = {
    name?: string
    schema: Record<string, AnyPgTable>
    devMode?: boolean
    storage?: "localstorage" | "memory" | "dexie" | RxStorage<unknown, unknown>
    enabled?: boolean
    dbURL?: string
    token?: string
    sync?: "ably" | false | undefined | null
    ablyToken?: string
    version?: number
    migrationStrategy?: (
        table: string,
        version: number,
        oldDocumentData: Record<string, unknown>,
        collection: RxCollection
    ) => unknown
    onPushError?: (params: {
        table: string
        operation: "delete" | "insert" | "update"
        document: Record<string, unknown>
        error: PostgrestError
    }) => void
}

export const $lofiConfig = atom<LofiConfig | null>(null)
