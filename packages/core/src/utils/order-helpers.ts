import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { OrderByConfig } from "../query/query-types"
import { tsToSqlColumn } from "./column-mapping"

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
 * Normalizes order by configuration to a consistent array format (SQL style).
 * Handles single object, array of strings, or array of objects.
 *
 * This is a shared utility used by both usePostgrestQuery and useLocalQuery.
 *
 * @param ensureIdSort - If true, ensures 'id asc' is appended as a secondary sort key
 *                       unless 'id' is already specified. This ensures stable ordering
 *                       for pagination when sorting by non-unique fields.
 */
export function normalizeSortConfig<TTable extends AnyPgTable>(
    orderByConfig: OrderByConfig<TTable>,
    table?: AnyPgTable,
    ensureIdSort = false
): Array<{
    column: string
    ascending: boolean
    stringSort?: "lexical" | "locale"
}> {
    // Handle single object format: { createdAt: "desc" }
    if (!Array.isArray(orderByConfig)) {
        const normalized: Array<{
            column: string
            ascending: boolean
            stringSort?: "lexical" | "locale"
        }> = []

        for (const [column, direction] of Object.entries(orderByConfig)) {
            const sqlColumn = table ? tsToSqlColumn(table, column) : column
            const stringSort = table
                ? getStringSortStrategy(table, column)
                : undefined

            normalized.push({
                column: sqlColumn,
                ascending: direction === "asc" || direction === undefined,
                stringSort
            })
        }

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

    // Handle array format: ["createdAt", "name"] or [{ createdAt: "desc" }, { name: "asc" }]
    const normalized = orderByConfig.flatMap((sortItem) => {
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

/**
 * Applies order by configuration to an array of records (for post-processing one-to-many relations).
 * Used by flatToHierarchical to sort relation arrays after grouping.
 */
export function applySortToArray<T extends Record<string, unknown>>(
    records: T[],
    orderByConfig: OrderByConfig<AnyPgTable>,
    table?: AnyPgTable
): T[] {
    const orders = normalizeSortConfig(orderByConfig, table, true)
    const sorted = [...records]

    sorted.sort((a, b) => {
        for (const { column, ascending, stringSort } of orders) {
            const aVal = a[column]
            const bVal = b[column]

            if (aVal === bVal) continue

            // Nulls sort last (Postgres default)
            if (aVal === null || aVal === undefined) return 1
            if (bVal === null || bVal === undefined) return -1

            let comparison = 0

            // Handle string sorting with strategy
            if (
                typeof aVal === "string" &&
                typeof bVal === "string" &&
                stringSort
            ) {
                if (stringSort === "locale") {
                    // Locale-aware (case-insensitive) comparison for citext
                    comparison = aVal.localeCompare(bVal)
                } else {
                    // Lexical (case-sensitive) comparison for text
                    comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
                }
            } else {
                // Non-string comparison (numbers, dates, etc.)
                comparison = aVal < bVal ? -1 : 1
            }

            if (comparison !== 0) {
                return ascending ? comparison : -comparison
            }
        }
        return 0
    })

    return sorted
}
