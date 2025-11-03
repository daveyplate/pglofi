import type { AnyPgTable } from "drizzle-orm/pg-core"

const DRIZZLE_TABLE_SYMBOL = Symbol.for("drizzle:IsDrizzleTable")

export type TablesOnly<TSchema> = {
    [K in keyof TSchema as TSchema[K] extends AnyPgTable ? K : never]: Extract<
        TSchema[K],
        AnyPgTable
    >
}

export function isPgTable(value: unknown): value is AnyPgTable {
    return (
        typeof value === "object" &&
        value !== null &&
        Boolean((value as Record<symbol, unknown>)[DRIZZLE_TABLE_SYMBOL])
    )
}

export function filterTableSchema<TSchema extends Record<string, unknown>>(
    schema: TSchema
): TablesOnly<TSchema> {
    const tableEntries = Object.entries(schema).filter(([, table]) =>
        isPgTable(table)
    )

    return Object.fromEntries(tableEntries) as TablesOnly<TSchema>
}
