import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { QueryConfig } from "../query/query-types"

export type LofiPlugin = {
    sync?: (
        schema: Record<string, AnyPgTable>,
        tableKey: string,
        config?: QueryConfig<Record<string, AnyPgTable>, string>
    ) => () => void
    write?: (
        schema: Record<string, AnyPgTable>,
        tableKey: string,
        operation: "delete" | "insert" | "update",
        id?: string,
        values?: Record<string, unknown>
    ) => Promise<{
        result?: Record<string, unknown>
        conflict?: boolean
    }>
}
