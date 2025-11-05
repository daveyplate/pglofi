import type { QueryConfig, SchemaCollections } from "@pglofi/core"
import type { AnyPgTable } from "drizzle-orm/pg-core"

export function syncQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    collections: SchemaCollections<TSchema>,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: TQueryConfig
) {
    // Implementation to be added
    return () => {}
}
