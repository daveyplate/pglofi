import type { AnyPgTable } from "drizzle-orm/pg-core"
import { tsToSqlColumn } from "./column-mapping"
import type { SortConfig } from "./lofi-query-types"

/**
 * Determines the appropriate stringSort strategy based on column type
 * - citext columns use 'locale' (case-insensitive, matches Postgres citext)
 * - text columns use 'lexical' (case-sensitive, matches Postgres text default)
 * - other columns return undefined (numbers, dates, etc. sort naturally)
 */
function getStringSortStrategy(
    table: AnyPgTable,
    columnKey: string
): "lexical" | "locale" | undefined {
    const column = table[columnKey as keyof typeof table] as {
        sqlName?: string
        dataType?: string
    }

    if (!column?.dataType) return undefined

    // Check if it's a citext column (case-insensitive)
    if (column.sqlName === "citext") {
        return "locale"
    }

    // Check if it's a text column (case-sensitive)
    if (column.dataType === "string") {
        return "lexical"
    }

    return undefined
}

/**
 * Normalizes sort configuration to a consistent array format (Mango Query style).
 * Handles array of strings or array of objects.
 *
 * This is a shared utility used by both usePostgrestQuery and useLocalQuery.
 *
 * @param ensureIdSort - If true, ensures 'id asc' is appended as a secondary sort key
 *                       unless 'id' is already specified. This ensures stable ordering
 *                       for pagination when sorting by non-unique fields.
 */
export function normalizeSortConfig<TTable extends AnyPgTable>(
    sortConfig: SortConfig<TTable>,
    table?: AnyPgTable,
    ensureIdSort = false
): Array<{
    column: string
    ascending: boolean
    stringSort?: "lexical" | "locale"
}> {
    // SortConfig is always an array in Mango Query format
    const normalized = sortConfig.flatMap((sortItem) => {
        if (typeof sortItem === "string") {
            // String format: ["createdAt", "name"] - defaults to ascending
            const sqlColumn = table ? tsToSqlColumn(table, sortItem) : sortItem
            const stringSort = table
                ? getStringSortStrategy(table, sortItem)
                : undefined

            return [{ column: sqlColumn, ascending: true, stringSort }]
        }

        // Object format: [{ createdAt: "desc" }, { name: "asc" }]
        return Object.entries(sortItem).map(([column, direction]) => {
            const sqlColumn = table ? tsToSqlColumn(table, column) : column
            const stringSort = table
                ? getStringSortStrategy(table, column)
                : undefined

            return {
                column: sqlColumn,
                ascending: direction === "asc" || direction === undefined,
                stringSort
            }
        })
    })

    // Ensure 'id' is included as a secondary sort key for stable ordering
    if (ensureIdSort) {
        const hasIdSort = normalized.some((order) => order.column === "id")
        if (!hasIdSort) {
            normalized.push({
                column: "id",
                ascending: true,
                stringSort: undefined
            })
        }
    }

    return normalized
}
