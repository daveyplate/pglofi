import type { AnyPgTable } from "drizzle-orm/pg-core"

export type LofiConfig = {
    name?: string
    schema: Record<string, AnyPgTable>
    devMode?: boolean
    storage?: "localstorage" | "memory"
    enabled?: boolean
}
