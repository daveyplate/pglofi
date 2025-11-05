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
        on?: string | Record<string, string> | Partial<Record<string, string>> | unknown
        many?: boolean
    }
): FKInfo {
    // Auto-detect if no explicit fields provided
    if (!options?.on) {
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
            // oneToMany.localColumn is on related table (todos.userId)
            // oneToMany.foreignColumn is on current table (profiles.id)
            // But FKInfo expects localColumn on current table, foreignColumn on related table
            return {
                localColumn: oneToMany.foreignColumn,  // Column on current table (profiles.id)
                foreignColumn: oneToMany.localColumn,  // Column on related table (todos.userId)
                foreignTable: relatedTableName,
                isOneToMany: true
            }
        }

        throw new Error(
            `Cannot auto-detect foreign key between "${currentTableName}" and "${relatedTableName}". No foreign key found in either direction.`
        )
    }

    // Handle on property
    let localField: string | undefined
    let foreignField: string | undefined
    
    // Helper to check if a column exists on a table (has dataType property)
    const hasColumn = (table: AnyPgTable, columnName: string): boolean => {
        const column = table[columnName as keyof typeof table] as {
            dataType?: string
        } | undefined
        return column?.dataType !== undefined
    }
    
    // Determine relationship direction: use explicit many if provided, otherwise auto-detect
    let detectedMany: boolean | undefined = options.many

    if (typeof options.on === "string") {
        // Auto-detect many when not explicitly set and on is a string
        if (detectedMany === undefined) {
            // Check if the column exists on the related table (one-to-many)
            const relatedHasColumn = hasColumn(relatedTable, options.on)
            
            // Check if the column exists on the current table (many-to-one)
            const currentHasColumn = hasColumn(currentTable, options.on)
            
            if (relatedHasColumn && !currentHasColumn) {
                // Column is on related table -> one-to-many
                detectedMany = true
            } else if (currentHasColumn && !relatedHasColumn) {
                // Column is on current table -> many-to-one
                detectedMany = false
            } else if (relatedHasColumn && currentHasColumn) {
                // Column exists on both - try to infer from FK direction
                // Try one-to-many first: FK on related table
                const oneToMany = findForeignKey(relatedTable, currentTableName)
                if (oneToMany && oneToMany.localColumn === tsToSqlColumn(relatedTable, options.on)) {
                    detectedMany = true
                } else {
                    // Try many-to-one: FK on current table
                    const manyToOne = findForeignKey(currentTable, relatedTableName)
                    if (manyToOne && manyToOne.localColumn === tsToSqlColumn(currentTable, options.on)) {
                        detectedMany = false
                    } else {
                        // Default to many-to-one if we can't determine
                        detectedMany = false
                    }
                }
            } else {
                // Column doesn't exist on either - default to many-to-one
                detectedMany = false
            }
        }
        
        // String format: 
        // - When many is false (many-to-one): string is localField on current table → maps to "id" on foreign table
        // - When many is true (one-to-many): string is foreignField on foreign table ← maps to "id" on local table
        if (detectedMany) {
            // One-to-many: string is foreignField on the foreign table, maps to "id" on local table
            // The FK column is on the current table and references the foreign table's column
            // Validate that the column exists on the foreign (related) table
            if (!hasColumn(relatedTable, options.on)) {
                throw new Error(
                    `Column "${options.on}" specified in 'on' does not exist on table "${relatedTableName}". ` +
                    `For one-to-many relationships (many: true), the 'on' column must exist on the foreign table.`
                )
            }
            
            foreignField = options.on  // Column on foreign table
            localField = "id"  // Will be found on current table via FK lookup
        } else {
            // Many-to-one: string is localField on current table, maps to "id" on foreign table
            // Validate that the column exists on the current table
            if (!hasColumn(currentTable, options.on)) {
                throw new Error(
                    `Column "${options.on}" specified in 'on' does not exist on table "${currentTableName}". ` +
                    `For many-to-one relationships (many: false), the 'on' column must exist on the current table.`
                )
            }
            
            localField = options.on  // Column on current table
            foreignField = "id"  // Defaults to "id" on foreign table
        }
    } else if (options.on && typeof options.on === "object") {
        // Object format: { localField: "foreignField" }
        const entries = Object.entries(options.on)
        if (entries.length > 0) {
            localField = entries[0][0]
            foreignField = entries[0][1] as string
        }
        
        // Auto-detect many when not explicitly set
        if (detectedMany === undefined) {
            // Check which table has the localField and foreignField
            const localFieldOnCurrent = hasColumn(currentTable, localField!)
            const foreignFieldOnRelated = hasColumn(relatedTable, foreignField!)
            
            // If localField is on current table and foreignField is on related table:
            // - Could be many-to-one (FK on current table: current.localField → related.foreignField)
            // - Could be one-to-many (FK on related table: related.foreignField → current.localField)
            // Try to find FK to determine direction
            if (localFieldOnCurrent && foreignFieldOnRelated) {
                // Try one-to-many first: FK on related table (most common case)
                const oneToMany = findForeignKey(relatedTable, currentTableName, {
                    localColumn: tsToSqlColumn(relatedTable, foreignField!),
                    foreignColumn: tsToSqlColumn(currentTable, localField!)
                })
                if (oneToMany) {
                    detectedMany = true
                } else {
                    // Try many-to-one: FK on current table
                    const manyToOne = findForeignKey(currentTable, relatedTableName, {
                        localColumn: tsToSqlColumn(currentTable, localField!),
                        foreignColumn: tsToSqlColumn(relatedTable, foreignField!)
                    })
                    if (manyToOne) {
                        detectedMany = false
                    } else {
                        // Default to many-to-one if we can't determine
                        detectedMany = false
                    }
                }
            } else {
                // Default to many-to-one if we can't determine
                detectedMany = false
            }
        }
    }
    
    // If many is still undefined after processing, default to false (many-to-one)
    if (detectedMany === undefined) {
        detectedMany = false
    }
    
    // Convert TypeScript property names to SQL column names if provided
    const currentSqlColumn = localField
        ? tsToSqlColumn(currentTable, localField)
        : undefined
    const foreignSqlColumn = foreignField
        ? tsToSqlColumn(relatedTable, foreignField)
        : undefined

    // Handle partial specification: infer missing column
    const localColumn =
        currentSqlColumn ??
        (detectedMany
            ? // One-to-many: FK is on related table, find it by looking for FK on related table that references current table
              findForeignKeyOrThrow(
                  relatedTable,
                  relatedTableName,
                  currentTableName,
                  { foreignColumn: foreignSqlColumn }
              ).localColumn
            : "id") // Shorthand assumes 'id' on current table

    const foreignColumn =
        foreignSqlColumn ??
        (detectedMany
            ? // One-to-many: FK is on related table, find the foreign column by looking for FK on related table
              findForeignKeyOrThrow(
                  relatedTable,
                  relatedTableName,
                  currentTableName,
                  { localColumn: localColumn }
              ).foreignColumn
            : "id") // Shorthand assumes 'id' on foreign table

    // Validate and return FK info based on relationship direction (using SQL column names)
    if (detectedMany) {
        // One-to-many: FK is on related table (the "many" side), references current table
        // Example: profiles → todos, FK is on todos.userId → profiles.id
        // localColumn is on current table (profiles.id), foreignColumn is on related table (todos.userId)
        findForeignKeyOrThrow(
            relatedTable,
            relatedTableName,
            currentTableName,
            {
                localColumn: foreignColumn,  // FK column on related table (todos.userId)
                foreignColumn: localColumn  // Referenced column on current table (profiles.id)
            }
        )

        return {
            localColumn: localColumn,  // Column on current table (profiles.id)
            foreignColumn: foreignColumn,  // Column on related table (todos.userId)
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
        `No foreign key found between "${currentTableName}.${localField || localColumn}" and "${relatedTableName}.${foreignField || foreignColumn}"`
    )
}

// Wrapper for resolveForeignKey that works with schema keys
export function getFKInfo<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    currentTableKey: keyof TSchema,
    relationConfig: {
        table: string
        many?: boolean
        on?: string | Record<string, string> | Partial<Record<string, string>> | unknown
    }
): FKInfo {
    const currentTable = schema[currentTableKey]
    const relatedTable = schema[relationConfig.table]

    return resolveForeignKey(
        currentTable,
        getTableName(currentTable),
        relatedTable,
        getTableName(relatedTable),
        {
            on: relationConfig.on,
            many: relationConfig.many
        }
    )
}
