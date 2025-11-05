import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { QueryConfig } from "../query/query-types"

export type SyncQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
> = (schema: TSchema, tableKey: TTableKey, config?: TQueryConfig) => () => void

export type LofiPlugin<TSchema extends Record<string, AnyPgTable>> = {
    sync?: <
        TTableKey extends keyof TSchema,
        TQueryConfig extends QueryConfig<TSchema, TTableKey>
    >(
        schema: TSchema,
        tableKey: TTableKey,
        config?: TQueryConfig
    ) => () => void
}
