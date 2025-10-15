import {
    getTableName,
    type InferInsertModel,
    type InferSelectModel,
    SQL
} from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { merge } from "lodash"
import { v7 } from "uuid"
import { tableCollections } from "./rxdb/rxdb"

const SQL_DEFAULT_HANDLERS = {
    "now()": () => new Date().toISOString(),
    "gen_random_uuid()": () => crypto.randomUUID(),
    "uuid_generate_v7()": () => v7()
}

/**
 * Converts all Date objects in the input to ISO strings
 * Handles nested objects and arrays recursively
 */
function convertDatesToStrings<T>(obj: T): T {
    if (obj === null || obj === undefined) {
        return obj
    }

    // Handle Date objects
    if (obj instanceof Date) {
        return obj.toISOString() as T
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map((item) => convertDatesToStrings(item)) as T
    }

    // Handle plain objects
    if (typeof obj === "object" && obj.constructor === Object) {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(obj)) {
            result[key] = convertDatesToStrings(value)
        }
        return result as T
    }

    // Return primitive values as-is
    return obj
}

export function createLofiMutators<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema
) {
    function getDefaultValues<TTableKey extends keyof TSchema>(
        tableKey: TTableKey
    ) {
        const schemaTable = schema[tableKey]
        const defaultValues: Record<string, unknown> = {}

        Object.entries(schemaTable).forEach(([column, tableColumn]) => {
            if (!tableColumn.dataType || !tableColumn.hasDefault) return

            const defaultValue = resolveDefaultValue(tableColumn.default)
            if (defaultValue === undefined) return

            defaultValues[column] = defaultValue
        })

        return defaultValues
    }

    function resolveDefaultValue(defaultValue: unknown) {
        const defaultType = typeof defaultValue

        // Handle SQL function defaults
        if (defaultType === "object" && defaultValue instanceof SQL) {
            // @ts-expect-error - Accessing internal drizzle SQL query structure
            const sqlString = defaultValue.toQuery({})
                .sql as keyof typeof SQL_DEFAULT_HANDLERS
            const handler = SQL_DEFAULT_HANDLERS[sqlString]
            return handler?.()
        }

        // Handle primitive defaults
        if (
            defaultType === "string" ||
            defaultType === "number" ||
            defaultType === "boolean" ||
            defaultType === "object"
        ) {
            return defaultValue
        }
    }

    async function insertEntity<TTableKey extends keyof TSchema>(
        tableKey: TTableKey,
        values: InferInsertModel<TSchema[TTableKey]>
    ) {
        const tableName = getTableName(schema[tableKey])
        const defaultValues = getDefaultValues(tableKey)

        // Convert any Date objects to ISO strings
        const sanitizedValues = convertDatesToStrings(values)

        const entity = {
            ...defaultValues,
            ...sanitizedValues,
            isPending: true
        } as InferSelectModel<TSchema[TTableKey]>

        tableCollections[tableName].insert(entity)

        return entity
    }

    async function updateEntity<TTableKey extends keyof TSchema>(
        tableKey: TTableKey,
        id: string,
        fields: Partial<InferInsertModel<TSchema[TTableKey]>>
    ) {
        const tableName = getTableName(schema[tableKey])

        // Convert any Date objects to ISO strings
        const sanitizedFields = convertDatesToStrings(fields)

        tableCollections[tableName].update(id, (draft) => {
            merge(draft, {
                ...sanitizedFields,
                isPending: true
            })
        })
    }

    async function deleteEntity<TTableKey extends keyof TSchema>(
        tableKey: TTableKey,
        id: string
    ) {
        const tableName = getTableName(schema[tableKey])
        tableCollections[tableName].delete(id)
    }

    return {
        insert: insertEntity,
        update: updateEntity,
        delete: deleteEntity
    }
}
