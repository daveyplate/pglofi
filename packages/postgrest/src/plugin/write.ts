import { tokenStore } from "@pglofi/core"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"

import { getPostgrest } from "../client/postgrest"
import { getColumnMapping, transformSqlToTs } from "../transform/column-mapping"

/**
 * Transforms an object with TypeScript property names to SQL column names.
 * Used when sending data to PostgREST.
 *
 * @example
 * const row = { userId: '123', isComplete: true }
 * transformTsToSql(todosTable, row)
 * // Returns: { user_id: '123', is_complete: true }
 */
function transformTsToSql(
    table: AnyPgTable,
    tsRow: Record<string, unknown>
): Record<string, unknown> {
    const mapping = getColumnMapping(table)
    const sqlRow: Record<string, unknown> = {}

    for (const [tsKey, value] of Object.entries(tsRow)) {
        const sqlKey = mapping.get(tsKey) || tsKey
        sqlRow[sqlKey] = value
    }

    return sqlRow
}

export async function write(
    schema: Record<string, AnyPgTable>,
    tableKey: string,
    operation: "delete" | "insert" | "update",
    id?: string,
    values?: Record<string, unknown>,
    dbURL?: string
): Promise<{
    result?: Record<string, unknown>
    conflict?: boolean
}> {
    const table = schema[tableKey]
    if (!table) {
        throw new Error(`Table "${tableKey}" not found in schema`)
    }

    const tableName = getTableName(table)
    const postgrest = getPostgrest(dbURL, tokenStore.state)

    if (operation === "delete") {
        if (!id) {
            console.error("ID is required for delete operation")
            throw new Error("ID is required for delete operation")
        }

        const { error } = await postgrest.from(tableName).delete().eq("id", id)

        if (error) {
            if (!error.code) throw error
            console.error(error)

            // Return conflict with the deleted document
            return {
                conflict: true
            }
        }

        return {
            result: { id, _deleted: true },
            conflict: false
        }
    } else if (operation === "update") {
        if (!id || !values) {
            console.error("ID and values are required for update operation")
            throw new Error("ID and values are required for update operation")
        }

        // Transform TypeScript property names to SQL column names
        const sqlUpdate = transformTsToSql(table, values)

        const { data, error } = await postgrest
            .from(tableName)
            .update(sqlUpdate)
            .eq("id", id)
            .select()

        if (error) {
            if (!error.code) throw error

            console.error(error)

            return {
                conflict: true
            }
        }

        if (!data || data.length === 0) {
            return {
                result: undefined,
                conflict: true
            }
        }

        // Transform SQL column names back to TypeScript property names
        const transformedData = transformSqlToTs(
            table,
            data[0] as Record<string, unknown>
        )

        return {
            result: transformedData,
            conflict: false
        }
    } else if (operation === "insert") {
        if (!values) {
            console.error("Values are required for insert operation")
            throw new Error("Values are required for insert operation")
        }

        // Transform TypeScript property names to SQL column names
        const sqlInsert = transformTsToSql(table, values)

        const { data, error } = await postgrest
            .from(tableName)
            .upsert(sqlInsert, {
                onConflict: "id"
            })
            .select()

        if (error) {
            if (!error.code) throw error
            console.error(error)

            // Return conflict with the inserted document marked as deleted
            return {
                conflict: true
            }
        }

        if (!data || data.length === 0) {
            return {
                result: undefined,
                conflict: true
            }
        }

        // Transform SQL column names back to TypeScript property names
        const transformedData = transformSqlToTs(
            table,
            data[0] as Record<string, unknown>
        )

        return {
            result: transformedData,
            conflict: false
        }
    }

    throw new Error(`Unknown operation: ${operation}`)
}
