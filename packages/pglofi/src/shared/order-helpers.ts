import type { AnyPgTable } from "drizzle-orm/pg-core"
import { tsToSqlColumn } from "./column-mapping"
import type { SortConfig } from "./lofi-query-types"

/**
 * Normalizes sort configuration to a consistent array format (Mango Query style).
 * Handles array of strings or array of objects.
 *
 * This is a shared utility used by both usePostgrestQuery and useLocalQuery.
 */
export function normalizeSortConfig<TTable extends AnyPgTable>(
    sortConfig: SortConfig<TTable>,
    table?: AnyPgTable
): Array<{ column: string; ascending: boolean }> {
    // SortConfig is always an array in Mango Query format
    return sortConfig.flatMap((sortItem) => {
        if (typeof sortItem === "string") {
            // String format: ["createdAt", "name"] - defaults to ascending
            const sqlColumn = table ? tsToSqlColumn(table, sortItem) : sortItem
            return [{ column: sqlColumn, ascending: true }]
        }

        // Object format: [{ createdAt: "desc" }, { name: "asc" }]
        return Object.entries(sortItem).map(([column, direction]) => {
            const sqlColumn = table ? tsToSqlColumn(table, column) : column
            return {
                column: sqlColumn,
                ascending: direction === "asc" || direction === undefined
            }
        })
    })
}
