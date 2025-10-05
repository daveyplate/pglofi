import type { AnyPgTable } from "drizzle-orm/pg-core"
import { tsToSqlColumn } from "./column-mapping"
import type { OrderByConfig } from "./lofi-query-types"

/**
 * Normalizes orderBy configuration to a consistent array format.
 * Handles string, object, and array inputs.
 *
 * This is a shared utility used by both usePostgrestQuery and useLocalQuery.
 */
export function normalizeOrderByConfig<TTable extends AnyPgTable>(
    orderByConfig: OrderByConfig<TTable>,
    table?: AnyPgTable
): Array<{ column: string; ascending: boolean }> {
    if (Array.isArray(orderByConfig)) {
        return orderByConfig.flatMap((order) =>
            normalizeOrderByConfig(order, table)
        )
    }

    if (typeof orderByConfig === "string") {
        const sqlColumn = table
            ? tsToSqlColumn(table, orderByConfig)
            : orderByConfig
        return [{ column: sqlColumn, ascending: true }]
    }

    // Object with column names as keys: { task: "asc", createdAt: "desc" }
    return Object.entries(orderByConfig).map(([column, direction]) => {
        const sqlColumn = table ? tsToSqlColumn(table, column) : column
        return {
            column: sqlColumn,
            ascending: direction === "asc" || direction === undefined
        }
    })
}
