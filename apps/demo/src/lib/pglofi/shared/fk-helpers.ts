import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"

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
    on?: string | Partial<Record<string, string>>,
    many?: boolean
): FKInfo {
    // Auto-detect if no 'on' parameter
    if (on === undefined) {
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

    // Parse 'on' parameter
    const { currentColumn, relatedColumn: parsedRelatedColumn } =
        parseOnParameter(on)

    // Handle shorthand: infer related column if not provided
    const relatedColumn =
        parsedRelatedColumn ??
        (many
            ? findForeignKeyOrThrow(
                  relatedTable,
                  relatedTableName,
                  currentTableName,
                  { foreignColumn: currentColumn }
              ).localColumn
            : "id") // Shorthand assumes 'id' on related table

    // Validate and return FK info based on relationship direction
    if (many) {
        // One-to-many: FK must be on related table
        findForeignKeyOrThrow(
            relatedTable,
            relatedTableName,
            currentTableName,
            {
                localColumn: relatedColumn,
                foreignColumn: currentColumn
            }
        )

        return {
            localColumn: relatedColumn,
            foreignColumn: currentColumn,
            foreignTable: relatedTableName,
            isOneToMany: true
        }
    }

    // Many-to-one: try FK on current table first
    const fk = findForeignKey(currentTable, relatedTableName, {
        localColumn: currentColumn,
        foreignColumn: relatedColumn
    })

    if (fk) {
        return {
            localColumn: currentColumn,
            foreignColumn: relatedColumn,
            foreignTable: relatedTableName,
            isOneToMany: false
        }
    }

    // Fallback: try one-to-many pattern
    const reverseFk = findForeignKey(relatedTable, currentTableName, {
        localColumn: relatedColumn,
        foreignColumn: currentColumn
    })

    if (reverseFk) {
        return {
            localColumn: relatedColumn,
            foreignColumn: currentColumn,
            foreignTable: relatedTableName,
            isOneToMany: true
        }
    }

    throw new Error(
        `No foreign key found between "${currentTableName}.${currentColumn}" and "${relatedTableName}.${relatedColumn}"`
    )
}

// Wrapper for resolveForeignKey that works with schema keys
export function getFKInfo<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    currentTableKey: keyof TSchema,
    relationConfig: {
        table: string
        many?: boolean
        on?: string | Partial<Record<string, string>>
    }
): FKInfo {
    const currentTable = schema[currentTableKey]
    const relatedTable = schema[relationConfig.table]

    return resolveForeignKey(
        currentTable,
        getTableName(currentTable),
        relatedTable,
        getTableName(relatedTable),
        relationConfig.on,
        relationConfig.many
    )
}
