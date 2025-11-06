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

/**
 * Converts a SQL column name back to TypeScript column name using the table's column mapping.
 */
export function sqlToTsColumn(
    table: AnyPgTable,
    sqlColumnName: string
): string {
    const mapping = getColumnMapping(table)
    for (const [tsName, sqlName] of mapping.entries()) {
        if (sqlName === sqlColumnName) {
            return tsName
        }
    }
    return sqlColumnName
}

/**
 * Creates a reverse mapping (SQL -> TS) for a table
 */
export function getReverseSqlMapping(table: AnyPgTable): Map<string, string> {
    const reverseMapping = new Map<string, string>()
    const mapping = getColumnMapping(table)

    for (const [tsName, sqlName] of mapping.entries()) {
        reverseMapping.set(sqlName, tsName)
    }

    return reverseMapping
}

/**
 * Transforms an object with SQL column names to TypeScript property names.
 * Used when receiving data from PostgREST.
 *
 * @example
 * const row = { user_id: '123', is_complete: true }
 * transformSqlToTs(todosTable, row)
 * // Returns: { userId: '123', isComplete: true }
 */
export function transformSqlToTs<T = Record<string, unknown>>(
    table: AnyPgTable,
    sqlRow: Record<string, unknown>
): T {
    const reverseMapping = getReverseSqlMapping(table)
    const tsRow: Record<string, unknown> = {}

    for (const [sqlKey, value] of Object.entries(sqlRow)) {
        const tsKey = reverseMapping.get(sqlKey) || sqlKey
        // Convert ID to string to match RxDB storage format
        tsRow[tsKey] = tsKey === "id" && value != null ? String(value) : value
    }

    return tsRow as T
}

/**
 * Transforms PostgREST response data with nested includes from SQL to TypeScript property names.
 * Recursively handles nested relationships.
 *
 * @param schema - The full schema for looking up table definitions
 * @param table - The root table being queried
 * @param data - The data returned from PostgREST
 * @param includeConfig - The include configuration to know which nested relations to transform
 */
export function transformPostgrestResponse<
    TSchema extends Record<string, AnyPgTable>
>(
    schema: TSchema,
    table: AnyPgTable,
    data: Record<string, unknown>[],
    includeConfig?: Record<string, unknown>
): unknown[] {
    return data.map((row) =>
        transformPostgrestRow(schema, table, row, includeConfig)
    )
}

/**
 * Transforms a single PostgREST row with nested includes.
 */
function transformPostgrestRow<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    table: AnyPgTable,
    row: Record<string, unknown>,
    includeConfig?: Record<string, unknown>
): Record<string, unknown> {
    // Transform root level columns
    const transformedRow = transformSqlToTs(table, row)

    // Handle nested includes
    if (includeConfig) {
        for (const [relationName, relationConfig] of Object.entries(
            includeConfig
        )) {
            const relationValue = transformedRow[relationName]
            if (relationValue === null || relationValue === undefined) {
                continue
            }

            // Resolve the related table
            const relatedTableKey =
                typeof relationConfig === "string"
                    ? relationConfig
                    : (relationConfig as { table: string }).table

            const relatedTable = schema[relatedTableKey]
            if (!relatedTable) continue

            // Get nested include config if it exists
            const nestedInclude =
                typeof relationConfig === "object" &&
                relationConfig !== null &&
                "include" in relationConfig
                    ? (relationConfig as { include?: Record<string, unknown> })
                          .include
                    : undefined

            // Transform nested data
            if (Array.isArray(relationValue)) {
                // One-to-many relationship
                transformedRow[relationName] = relationValue.map((nestedRow) =>
                    transformPostgrestRow(
                        schema,
                        relatedTable,
                        nestedRow as Record<string, unknown>,
                        nestedInclude
                    )
                )
            } else if (typeof relationValue === "object") {
                // Many-to-one or one-to-one relationship
                transformedRow[relationName] = transformPostgrestRow(
                    schema,
                    relatedTable,
                    relationValue as Record<string, unknown>,
                    nestedInclude
                )
            }
        }
    }

    return transformedRow
}
