import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useEffect, useRef, useState } from "react"
import { getForeignKeys } from "./shared/fk-helpers"
import type { QueryConfig } from "./shared/lofi-query-types"
import { useAblySubscriptions } from "./use-ably-subscriptions"

/**
 * Determines Ably channels to subscribe to based on query structure and data.
 *
 * Channel naming follows the pattern from outbox triggers:
 * - Primary channels: `tableName:id:{id}`
 * - Foreign key channels: `tableName:fkColumn:{value}`
 */
export function useAblyChannels<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema
>(
    schema: TSchema,
    tableKey: TTableKey | null | undefined | false | "" | 0,
    query: QueryConfig<TSchema, TSchema[TTableKey]> | undefined,
    data: Record<string, unknown>[] | undefined
) {
    const [channels, setChannels] = useState<string[]>([])
    const prevChannelsRef = useRef<string>("")

    useEffect(() => {
        if (!tableKey || !data || data.length === 0) {
            const newChannelsKey = ""
            if (prevChannelsRef.current !== newChannelsKey) {
                prevChannelsRef.current = newChannelsKey
                setChannels([])
            }
            return
        }

        const table = schema[tableKey]
        const tableName = getTableName(table)
        const allChannels = new Set<string>()

        // Get all foreign keys for this table
        const foreignKeys = getForeignKeys(table)
        const fkColumns = new Map<string, string>() // column name -> referenced table name

        for (const fk of foreignKeys) {
            const ref = fk.reference()
            const localCol = ref.columns[0]?.name
            const refTableName = getTableName(ref.foreignTable)
            if (localCol) {
                fkColumns.set(localCol, refTableName)
            }
        }

        // Check if we have any non-many includes that use foreign keys
        const hasNonManyFKInclude = checkForNonManyFKIncludes(
            schema,
            table,
            tableName,
            query?.include,
            fkColumns
        )

        if (hasNonManyFKInclude.length > 0) {
            // Case 1: We have non-many FK includes - subscribe to FK channels
            for (const entity of data) {
                for (const fkColumnName of hasNonManyFKInclude) {
                    const value = entity[fkColumnName]
                    if (value != null) {
                        allChannels.add(`${tableName}:${fkColumnName}:${value}`)
                    }
                }
            }
        } else {
            // Case 2: No non-many FK includes - subscribe to entity ID channels
            for (const entity of data) {
                if (entity.id) {
                    allChannels.add(`${tableName}:id:${entity.id}`)
                }
            }
        }

        // Case 3: Recursively handle all includes
        if (query?.include) {
            processIncludes(schema, query.include, data, allChannels)
        }

        const channelArray = Array.from(allChannels).sort()
        const newChannelsKey = channelArray.join(",")

        // Only update state if channels actually changed
        if (prevChannelsRef.current !== newChannelsKey) {
            prevChannelsRef.current = newChannelsKey
            setChannels(channelArray)

            // Log channels for debugging
            console.log(`[useAblyChannels] ${tableName}:`, channelArray)
        }
    }, [schema, tableKey, query, data])

    // Subscribe to the channels
    useAblySubscriptions(channels)

    return [channels, setChannels] as const
}

/**
 * Checks if we have any non-many includes that are based on foreign keys
 */
function checkForNonManyFKIncludes<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    table: AnyPgTable,
    tableName: string,
    includes: Record<string, unknown> | undefined,
    fkColumns: Map<string, string>
): string[] {
    if (!includes) return []

    const fkIncludeColumns: string[] = []

    for (const [_relationName, includeConfig] of Object.entries(includes)) {
        // Handle shorthand includes (e.g., { user: "profiles" })
        if (typeof includeConfig === "string") {
            const relatedTableName = getTableName(schema[includeConfig])
            // Check if we have a FK to this table
            for (const [colName, refTable] of fkColumns.entries()) {
                if (refTable === relatedTableName) {
                    fkIncludeColumns.push(colName)
                }
            }
        } else if (
            typeof includeConfig === "object" &&
            includeConfig !== null &&
            "table" in includeConfig &&
            typeof includeConfig.table === "string" &&
            !("many" in includeConfig && includeConfig.many)
        ) {
            // Handle explicit non-many includes
            const relatedTableName = getTableName(schema[includeConfig.table])

            // If 'on' is explicitly provided, use it
            if ("on" in includeConfig && includeConfig.on) {
                if (typeof includeConfig.on === "string") {
                    fkIncludeColumns.push(includeConfig.on)
                } else if (
                    typeof includeConfig.on === "object" &&
                    includeConfig.on !== null
                ) {
                    const colName = Object.keys(includeConfig.on)[0]
                    if (colName) {
                        fkIncludeColumns.push(colName)
                    }
                }
            } else {
                // Auto-detect FK
                for (const [colName, refTable] of fkColumns.entries()) {
                    if (refTable === relatedTableName) {
                        fkIncludeColumns.push(colName)
                    }
                }
            }
        }
    }

    return fkIncludeColumns
}

/**
 * Recursively processes all includes and adds their channels
 */
function processIncludes<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    includes: Record<string, unknown>,
    data: Record<string, unknown>[],
    allChannels: Set<string>
) {
    for (const [relationName, includeConfig] of Object.entries(includes)) {
        let relatedTableKey: string
        let isMany = false
        let nestedInclude: Record<string, unknown> | undefined
        let onConfig: string | Record<string, string> | undefined

        // Parse the include config
        if (typeof includeConfig === "string") {
            relatedTableKey = includeConfig
        } else if (
            typeof includeConfig === "object" &&
            includeConfig !== null &&
            "table" in includeConfig
        ) {
            relatedTableKey = includeConfig.table as string
            isMany =
                (("many" in includeConfig && includeConfig.many) as boolean) ||
                false
            nestedInclude = (
                "include" in includeConfig ? includeConfig.include : undefined
            ) as Record<string, unknown> | undefined
            onConfig = ("on" in includeConfig ? includeConfig.on : undefined) as
                | string
                | Record<string, string>
                | undefined
        } else {
            continue
        }

        const relatedTable = schema[relatedTableKey]
        if (!relatedTable) continue

        const relatedTableName = getTableName(relatedTable)

        // Get foreign keys for the related table
        const relatedForeignKeys = getForeignKeys(relatedTable)
        const relatedFkColumns = new Map<string, string>()

        for (const fk of relatedForeignKeys) {
            const ref = fk.reference()
            const localCol = ref.columns[0]?.name
            const refTableName = getTableName(ref.foreignTable)
            if (localCol) {
                relatedFkColumns.set(localCol, refTableName)
            }
        }

        // Collect all related entities
        const relatedEntities: Record<string, unknown>[] = []
        for (const entity of data) {
            const relatedData = entity[relationName]
            if (Array.isArray(relatedData)) {
                relatedEntities.push(
                    ...(relatedData as Record<string, unknown>[])
                )
            } else if (relatedData != null && typeof relatedData === "object") {
                relatedEntities.push(relatedData as Record<string, unknown>)
            }
        }

        if (relatedEntities.length === 0) continue

        if (isMany && onConfig) {
            // For many relationships with explicit 'on', check if it's a FK-based join
            let fkColumnName: string | undefined

            if (typeof onConfig === "string") {
                fkColumnName = onConfig
            } else if (typeof onConfig === "object") {
                const relatedColName = Object.values(onConfig)[0] as string
                // Check if the related table has a FK on this column
                for (const [colName, _] of relatedFkColumns.entries()) {
                    if (colName === relatedColName) {
                        fkColumnName = colName
                        break
                    }
                }
            }

            if (fkColumnName) {
                // Subscribe to FK channels
                const fkValues = new Set<string>()
                for (const relatedEntity of relatedEntities) {
                    const value = relatedEntity[fkColumnName]
                    if (value != null) {
                        fkValues.add(String(value))
                    }
                }
                for (const value of fkValues) {
                    allChannels.add(
                        `${relatedTableName}:${fkColumnName}:${value}`
                    )
                }
            } else {
                // No FK, subscribe to entity IDs
                for (const relatedEntity of relatedEntities) {
                    if ("id" in relatedEntity && relatedEntity.id) {
                        allChannels.add(
                            `${relatedTableName}:id:${relatedEntity.id as string}`
                        )
                    }
                }
            }
        } else {
            // For non-many relationships, check if there are FK-based includes
            const hasFK = checkForNonManyFKIncludes(
                schema,
                relatedTable,
                relatedTableName,
                nestedInclude,
                relatedFkColumns
            )

            if (hasFK.length > 0) {
                // Subscribe to FK channels
                for (const relatedEntity of relatedEntities) {
                    for (const fkColName of hasFK) {
                        const value = relatedEntity[fkColName]
                        if (value != null) {
                            allChannels.add(
                                `${relatedTableName}:${fkColName}:${value}`
                            )
                        }
                    }
                }
            } else {
                // Subscribe to entity ID channels
                for (const relatedEntity of relatedEntities) {
                    if ("id" in relatedEntity && relatedEntity.id) {
                        allChannels.add(
                            `${relatedTableName}:id:${relatedEntity.id as string}`
                        )
                    }
                }
            }
        }

        // Recursively process nested includes
        if (nestedInclude && relatedEntities.length > 0) {
            processIncludes(schema, nestedInclude, relatedEntities, allChannels)
        }
    }
}
