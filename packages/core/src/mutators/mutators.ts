import { type InferInsertModel, type InferSelectModel, SQL } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { merge } from "lodash-es"
import { v7 } from "uuid"
import { collectionsStore } from "../stores"
import type { TableKey, TablesOnly } from "../utils/schema-filter"

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

function getDefaultValues<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema
>(schema: TSchema, tableKey: TTableKey) {
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

export async function insertEntity<
    TSchema extends Record<string, unknown>,
    TTableKey extends TableKey<TSchema>
>(
    schema: TablesOnly<TSchema>,
    tableKey: TTableKey,
    values: InferInsertModel<TablesOnly<TSchema>[TTableKey]>
) {
    const defaultValues = getDefaultValues(schema, tableKey)

    // Convert any Date objects to ISO strings
    const sanitizedValues = convertDatesToStrings(values)

    const entity = {
        ...defaultValues,
        ...sanitizedValues,
        isPending: true
    } as InferSelectModel<TablesOnly<TSchema>[TTableKey]> & {
        id: string
        isPending?: boolean
    }

    collectionsStore.state[tableKey].insert(entity)

    return entity
}

export async function updateEntity<
    TSchema extends Record<string, unknown>,
    TTableKey extends TableKey<TSchema>
>(
    schema: TablesOnly<TSchema>,
    tableKey: TTableKey,
    id: string,
    fields: Partial<InferInsertModel<TablesOnly<TSchema>[TTableKey]>>
) {
    // Convert any Date objects to ISO strings
    const sanitizedFields = convertDatesToStrings(fields)

    const collection = collectionsStore.state[tableKey]
    // biome-ignore lint/suspicious/noExplicitAny: TanStack DB draft type is complex
    collection.update(id, (draft: any) => {
        merge(draft, {
            ...sanitizedFields,
            isPending: true
        })
    })
}

export async function deleteEntity<
    TSchema extends Record<string, unknown>,
    TTableKey extends TableKey<TSchema>
>(schema: TablesOnly<TSchema>, tableKey: TTableKey, id: string) {
    collectionsStore.state[tableKey].delete(id)
}
