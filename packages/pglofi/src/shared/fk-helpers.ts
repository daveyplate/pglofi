import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { tsToSqlColumn } from "./column-mapping"

// Helper to get foreign keys from a Drizzle table
export function getForeignKeys(table: AnyPgTable) {
    const syms = Object.getOwnPropertySymbols(table)
    const fkSym = syms.find(
        (s) => s.description === "drizzle:PgInlineForeignKeys"
    )
    // @ts-expect-error - we know this is a symbol
    return fkSym ? table[fkSym] || [] : []
}

// Core FK resolution: finds FK on a table that references a target table
export function findForeignKey(
    sourceTable: AnyPgTable,
    targetTableName: string,
    options?: { localColumn?: string; foreignColumn?: string }
) {
    for (const fk of getForeignKeys(sourceTable)) {
        const ref = fk.reference()
        const refTableName = getTableName(ref.foreignTable)
        const localCol = ref.columns[0]?.name
        const foreignCol = ref.foreignColumns[0]?.name

        if (
            refTableName === targetTableName &&
            (!options?.localColumn || localCol === options.localColumn) &&
            (!options?.foreignColumn || foreignCol === options.foreignColumn)
        ) {
            return { localColumn: localCol, foreignColumn: foreignCol }
        }
    }
    return null
}

// Helper to find FK or throw descriptive error
export function findForeignKeyOrThrow(
    sourceTable: AnyPgTable,
    sourceTableName: string,
    targetTableName: string,
    options?: { localColumn?: string; foreignColumn?: string }
) {
    const fk = findForeignKey(sourceTable, targetTableName, options)
    if (!fk) {
        const details =
            options?.localColumn && options?.foreignColumn
                ? ` with "${sourceTableName}.${options.localColumn}" → "${targetTableName}.${options.foreignColumn}"`
                : options?.foreignColumn
                  ? ` that references "${targetTableName}.${options.foreignColumn}"`
                  : ""
        throw new Error(
            `No foreign key found on "${sourceTableName}"${details}`
        )
    }
    return fk
}

// Helper to parse 'on' parameter into column names
export function parseOnParameter(
    on: string | Partial<Record<string, string>>
): {
    currentColumn: string
    relatedColumn?: string
} {
    if (typeof on === "string") {
        return { currentColumn: on }
    }

    const entries = Object.entries(on)
    const entry = entries[0]

    if (entries.length !== 1 || !entry?.[0] || !entry?.[1]) {
        throw new Error(
            "Invalid 'on' parameter: must have exactly one column mapping"
        )
    }

    return { currentColumn: entry[0], relatedColumn: entry[1] }
}

// Export FK info type for use in other modules
export type FKInfo = {
    localColumn: string
    foreignColumn: string
    foreignTable: string
    isOneToMany: boolean
}

// Resolves FK info between two tables, handling auto-detection and explicit mappings
export function resolveForeignKey(
    currentTable: AnyPgTable,
    currentTableName: string,
    relatedTable: AnyPgTable,
    relatedTableName: string,
    options?: {
        localField?: string
        foreignField?: string
        many?: boolean
    }
): FKInfo {
    // Auto-detect if no explicit fields provided
    if (!options?.localField && !options?.foreignField) {
        // Try many-to-one: FK on current table
        const manyToOne = findForeignKey(currentTable, relatedTableName)
        if (manyToOne) {
            return {
                ...manyToOne,
                foreignTable: relatedTableName,
                isOneToMany: false
            }
        }

        // Try one-to-many: FK on related table
        const oneToMany = findForeignKey(relatedTable, currentTableName)
        if (oneToMany) {
            return {
                localColumn: oneToMany.localColumn,
                foreignColumn: oneToMany.foreignColumn,
                foreignTable: relatedTableName,
                isOneToMany: true
            }
        }

        throw new Error(
            `Cannot auto-detect foreign key between "${currentTableName}" and "${relatedTableName}". No foreign key found in either direction.`
        )
    }

    // Convert TypeScript property names to SQL column names if provided
    const currentSqlColumn = options.localField
        ? tsToSqlColumn(currentTable, options.localField)
        : undefined
    const foreignSqlColumn = options.foreignField
        ? tsToSqlColumn(relatedTable, options.foreignField)
        : undefined

    // Handle partial specification: infer missing column
    const localColumn =
        currentSqlColumn ??
        (options.many
            ? findForeignKeyOrThrow(
                  relatedTable,
                  relatedTableName,
                  currentTableName,
                  { foreignColumn: foreignSqlColumn }
              ).foreignColumn
            : "id") // Shorthand assumes 'id' on current table

    const foreignColumn =
        foreignSqlColumn ??
        (options.many
            ? findForeignKeyOrThrow(
                  relatedTable,
                  relatedTableName,
                  currentTableName,
                  { foreignColumn: localColumn }
              ).localColumn
            : "id") // Shorthand assumes 'id' on foreign table

    // Validate and return FK info based on relationship direction (using SQL column names)
    if (options.many) {
        // One-to-many: FK must be on related table
        findForeignKeyOrThrow(
            relatedTable,
            relatedTableName,
            currentTableName,
            {
                localColumn: foreignColumn,
                foreignColumn: localColumn
            }
        )

        return {
            localColumn: foreignColumn,
            foreignColumn: localColumn,
            foreignTable: relatedTableName,
            isOneToMany: true
        }
    }

    // Many-to-one: try FK on current table first
    const fk = findForeignKey(currentTable, relatedTableName, {
        localColumn: localColumn,
        foreignColumn: foreignColumn
    })

    if (fk) {
        return {
            localColumn: localColumn,
            foreignColumn: foreignColumn,
            foreignTable: relatedTableName,
            isOneToMany: false
        }
    }

    // Fallback: try one-to-many pattern
    const reverseFk = findForeignKey(relatedTable, currentTableName, {
        localColumn: foreignColumn,
        foreignColumn: localColumn
    })

    if (reverseFk) {
        return {
            localColumn: foreignColumn,
            foreignColumn: localColumn,
            foreignTable: relatedTableName,
            isOneToMany: true
        }
    }

    throw new Error(
        `No foreign key found between "${currentTableName}.${options.localField || localColumn}" and "${relatedTableName}.${options.foreignField || foreignColumn}"`
    )
}

// Wrapper for resolveForeignKey that works with schema keys
export function getFKInfo<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    currentTableKey: keyof TSchema,
    relationConfig: {
        from: string
        many?: boolean
        localField?: string
        foreignField?: string
    }
): FKInfo {
    const currentTable = schema[currentTableKey]
    const relatedTable = schema[relationConfig.from]

    return resolveForeignKey(
        currentTable,
        getTableName(currentTable),
        relatedTable,
        getTableName(relatedTable),
        {
            localField: relationConfig.localField,
            foreignField: relationConfig.foreignField,
            many: relationConfig.many
        }
    )
}
