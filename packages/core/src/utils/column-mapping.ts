import type { AnyPgTable } from "drizzle-orm/pg-core"

/**
 * Extracts column mapping information from a Drizzle table.
 * Maps TypeScript property names to SQL column names.
 *
 * @example
 * const table = pgTable('todos', {
 *   userId: text('user_id'),
 *   isComplete: boolean('is_complete')
 * })
 * getColumnMapping(table)
 * // Returns: Map { 'userId' => 'user_id', 'isComplete' => 'is_complete' }
 */
export function getColumnMapping(table: AnyPgTable): Map<string, string> {
    const mapping = new Map<string, string>()
    const columns = Object.keys(table) as (keyof typeof table)[]

    for (const columnKey of columns) {
        const column = table[columnKey] as {
            name?: string
            dataType?: string
        }

        // Only process actual column objects (they have dataType)
        if (!column.dataType) continue

        const tsName = String(columnKey)
        const sqlName = column.name || tsName

        mapping.set(tsName, sqlName)
    }

    return mapping
}

/**
 * Converts a TypeScript column name to SQL column name using the table's column mapping.
 */
export function tsToSqlColumn(table: AnyPgTable, tsColumnName: string): string {
    const mapping = getColumnMapping(table)
    return mapping.get(tsColumnName) || tsColumnName
}
