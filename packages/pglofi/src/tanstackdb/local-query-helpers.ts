import {
    and,
    eq,
    gt,
    gte,
    ilike,
    inArray,
    like,
    lt,
    lte,
    not,
    or
} from "@tanstack/react-db"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { tableCollections } from "../rxdb/rxdb"
import { type FKInfo, getFKInfo } from "../shared/fk-helpers"
import type { OrderByConfig, QueryConfig } from "../shared/lofi-query-types"
import {
    getOperatorAndValue,
    isLogicalOperator,
    normalizeWhereCondition,
    type WhereConfig
} from "../shared/lofi-where-types"
import { normalizeOrderByConfig } from "../shared/order-helpers"

// Type for table records with dynamic structure
type TableRecord = Record<string, unknown>

// Type for TanStack DB condition expressions
type ConditionExpression = unknown

/**
 * Applies a single comparison operator for TanStack DB queries.
 * Handles negation wrapper if needed.
 */
function applyComparisonOperator(
    columnRef: unknown,
    operator: string,
    value: unknown,
    isNegated = false
): ConditionExpression {
    let result: ConditionExpression

    switch (operator) {
        case "eq":
            result = eq(columnRef as never, value)
            break
        case "neq":
            result = not(eq(columnRef as never, value))
            break
        case "gt":
            result = gt(columnRef as never, value)
            break
        case "gte":
            result = gte(columnRef as never, value)
            break
        case "lt":
            result = lt(columnRef as never, value)
            break
        case "lte":
            result = lte(columnRef as never, value)
            break
        case "like":
            result = like(columnRef as never, value as string)
            break
        case "ilike":
            result = ilike(columnRef as never, value as string)
            break
        case "in":
            result = inArray(columnRef as never, value as unknown[])
            break
        case "is":
            result = eq(columnRef as never, value)
            break
        default:
            result = eq(columnRef as never, value)
    }

    return isNegated ? not(result) : result
}

/**
 * Recursively builds where condition expressions for TanStack DB.
 * Handles AND/OR logical operators and basic column conditions.
 */
function buildWhereExpression(
    parentAlias: string,
    whereConfig: WhereConfig<AnyPgTable>
): (tables: Record<string, TableRecord>) => ConditionExpression {
    // Handle AND logical operator
    if (
        isLogicalOperator(whereConfig) &&
        "and" in whereConfig &&
        whereConfig.and
    ) {
        const conditions = whereConfig.and.map((subWhere) =>
            buildWhereExpression(parentAlias, subWhere)
        )
        return (tables: Record<string, TableRecord>) => {
            const results = conditions.map((condFn) => condFn(tables))
            if (results.length === 0) return true
            if (results.length === 1) return results[0]
            return and(results[0], results[1], ...results.slice(2))
        }
    }

    // Handle OR logical operator
    if (
        isLogicalOperator(whereConfig) &&
        "or" in whereConfig &&
        whereConfig.or
    ) {
        const conditions = whereConfig.or.map((subWhere) =>
            buildWhereExpression(parentAlias, subWhere)
        )
        return (tables: Record<string, TableRecord>) => {
            const results = conditions.map((condFn) => condFn(tables))
            if (results.length === 0) return false
            if (results.length === 1) return results[0]
            return or(results[0], results[1], ...results.slice(2))
        }
    }

    // Handle basic column conditions
    const columnConditions: Array<
        (tables: Record<string, TableRecord>) => ConditionExpression
    > = []

    for (const [column, condition] of Object.entries(whereConfig)) {
        if (column === "and" || column === "or") continue

        const normalized = normalizeWhereCondition(condition)
        const { operator, value, isNegated } = getOperatorAndValue(normalized)

        columnConditions.push((tables: Record<string, TableRecord>) => {
            const table = tables[parentAlias]
            return applyComparisonOperator(
                table[column],
                operator,
                value,
                isNegated || false
            )
        })
    }

    if (columnConditions.length === 0) {
        return () => true as ConditionExpression
    }

    if (columnConditions.length === 1) {
        return columnConditions[0]
    }

    // Multiple conditions default to AND
    return (tables: Record<string, TableRecord>) => {
        const results = columnConditions.map((condFn) => condFn(tables))
        return and(results[0], results[1], ...results.slice(2))
    }
}

/**
 * Applies sorting to an array of records based on order configuration.
 * Handles multiple sort keys and null/undefined values.
 */
function applyOrderToArray<T extends TableRecord>(
    records: T[],
    orderByConfig: OrderByConfig<AnyPgTable>
): T[] {
    const orders = normalizeOrderByConfig(orderByConfig)
    const sorted = [...records]

    sorted.sort((a, b) => {
        for (const { column, ascending } of orders) {
            const aVal = a[column]
            const bVal = b[column]

            if (aVal === bVal) continue

            // Nulls sort last
            if (aVal === null || aVal === undefined) return 1
            if (bVal === null || bVal === undefined) return -1

            const comparison = aVal < bVal ? -1 : 1
            return ascending ? comparison : -comparison
        }
        return 0
    })

    return sorted
}

/**
 * Builds a join condition function for TanStack DB.
 * Handles both one-to-many and many-to-one relationships.
 */
export function buildJoinCondition(
    parentAlias: string,
    relatedAlias: string,
    fkInfo: FKInfo
) {
    return (tables: Record<string, TableRecord>) => {
        const parent = tables[parentAlias]
        const related = tables[relatedAlias]

        // For one-to-many: parent.foreignColumn === related.localColumn
        // For many-to-one: parent.localColumn === related.foreignColumn
        if (fkInfo.isOneToMany) {
            return eq(parent[fkInfo.foreignColumn], related[fkInfo.localColumn])
        }
        return eq(parent[fkInfo.localColumn], related[fkInfo.foreignColumn])
    }
}

/**
 * Applies order, limit, and offset to a TanStack DB query.
 * Defaults to ordering by 'createdAt asc' if no explicit order is provided.
 */
export function applyOrderLimitOffset<
    TSchema extends Record<string, AnyPgTable>
>(
    q: unknown,
    parentAlias: string,
    query?: QueryConfig<TSchema, AnyPgTable>
): unknown {
    let currentQuery = q

    const hasExplicitOrder = query?.orderBy !== undefined

    // Always apply order, defaulting to 'createdAt asc' if no explicit order is provided
    const orders = hasExplicitOrder
        ? normalizeOrderByConfig(query.orderBy!)
        : [{ column: "createdAt", ascending: true }]

    for (const { column, ascending } of orders) {
        currentQuery = (
            currentQuery as {
                orderBy: (
                    // biome-ignore lint/suspicious/noExplicitAny: TanStack DB orderBy selector type with joins
                    selector: any,
                    direction?: "asc" | "desc"
                ) => unknown
            }
        ).orderBy(
            (row: unknown) => {
                const tables = row as Record<string, TableRecord>
                return (tables[parentAlias] as TableRecord)[column]
            },
            ascending ? "asc" : "desc"
        )
    }

    // Apply limit
    if (query?.limit !== undefined) {
        currentQuery = (
            currentQuery as { limit: (count: number) => unknown }
        ).limit(query.limit)
    }

    // Apply offset
    if (query?.offset !== undefined) {
        currentQuery = (
            currentQuery as { offset: (count: number) => unknown }
        ).offset(query.offset)
    }

    return currentQuery
}

/**
 * Builds a complete TanStack DB query with where conditions, joins, and ordering.
 * Recursively handles nested includes and applies all filters in one pass.
 *
 * Note: order/limit/offset for joins are applied post-processing in flatToHierarchical
 * because TanStack DB doesn't support them at query time for relations.
 */
export function buildLocalQuery<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    q: unknown,
    parentTableName: keyof TSchema,
    parentTableKey: keyof TSchema,
    parentAlias: string,
    query?: QueryConfig<TSchema, AnyPgTable>,
    isRoot = true
) {
    let currentQuery = q

    // Apply where conditions (for both root and joins)
    if (query?.where) {
        const whereExpression = buildWhereExpression(parentAlias, query.where)
        currentQuery = (
            currentQuery as { where: (expr: unknown) => unknown }
        ).where(whereExpression)
    }

    // Apply order/limit/offset (only for root - joins handle this in post-processing)
    if (isRoot) {
        currentQuery = applyOrderLimitOffset(currentQuery, parentAlias, query)
    }

    // Build joins recursively
    if (query?.include) {
        for (const [relationName, relationConfig] of Object.entries(
            query.include
        )) {
            const config =
                typeof relationConfig === "string"
                    ? { table: relationConfig }
                    : relationConfig

            const relatedTable = schema[config.table]
            const relatedTableName = getTableName(relatedTable)
            const relatedCollection = tableCollections[relatedTableName]

            // Get foreign key info
            const fkInfo = getFKInfo(schema, parentTableKey, config)

            // Create alias for the related table
            const relatedAlias = `${parentAlias}_${relationName}`

            // Build join condition (FK relationship only)
            const joinCondition = buildJoinCondition(
                parentAlias,
                relatedAlias,
                fkInfo
            )

            // Add join to query
            currentQuery = (
                currentQuery as {
                    join: (
                        tables: unknown,
                        condition: unknown,
                        type: string
                    ) => unknown
                }
            ).join({ [relatedAlias]: relatedCollection }, joinCondition, "left")

            // Recursively handle this relation's where conditions and nested includes
            currentQuery = buildLocalQuery(
                schema,
                currentQuery,
                relatedTableName,
                config.table,
                relatedAlias,
                config,
                false
            )
        }
    }

    return currentQuery
}

/**
 * Converts flat join results to hierarchical format.
 * Groups related data by parent ID and applies limits/offsets to one-to-many relations.
 */
export function flatToHierarchical<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    flatResults: TableRecord[],
    parentTableName: string,
    parentTableKey: keyof TSchema,
    parentAlias: string,
    query?: QueryConfig<TSchema, AnyPgTable>
) {
    // If no includes, data is not aliased - return as-is
    if (!query?.include || flatResults.length === 0) {
        return flatResults
    }

    // Group by parent ID
    const parentMap = new Map<string | number, TableRecord>()

    for (const row of flatResults) {
        const parent = row[parentAlias]
        if (!parent) continue

        const parentId = (parent as TableRecord & { id: string | number }).id
        let parentEntry = parentMap.get(parentId)

        if (!parentEntry) {
            // Clone parent and initialize include properties
            parentEntry = { ...parent }
            parentMap.set(parentId, parentEntry)

            // Initialize include properties
            for (const [relationName, relationConfig] of Object.entries(
                query.include
            )) {
                const config: {
                    table: string
                    many?: boolean
                    on?: string | Partial<Record<string, string>>
                } =
                    typeof relationConfig === "string"
                        ? { table: relationConfig }
                        : (relationConfig as {
                              table: string
                              many?: boolean
                              on?: string | Partial<Record<string, string>>
                          })
                const fkInfo = getFKInfo(schema, parentTableKey, config)

                // Initialize as array for one-to-many, null for many-to-one
                parentEntry[relationName] = fkInfo.isOneToMany ? [] : null
            }
        }

        // Process each include
        for (const [relationName, relationConfig] of Object.entries(
            query.include
        )) {
            const config: {
                table: string
                include?: unknown
                where?: unknown
                many?: boolean
                limit?: number
                offset?: number
                orderBy?: OrderByConfig<AnyPgTable>
                on?: string | Partial<Record<string, string>>
            } =
                typeof relationConfig === "string"
                    ? { table: relationConfig }
                    : (relationConfig as {
                          table: string
                          include?: unknown
                          where?: unknown
                          many?: boolean
                          limit?: number
                          offset?: number
                          orderBy?: OrderByConfig<AnyPgTable>
                          on?: string | Partial<Record<string, string>>
                      })

            const relatedAlias: string = `${parentAlias}_${relationName}`
            const relatedData = row[relatedAlias]

            if (!relatedData) continue

            const fkInfo = getFKInfo(schema, parentTableKey, config)

            // Recursively process nested includes
            let processedRelated = relatedData
            if (config.include) {
                // For nested includes, construct a synthetic row with the related data as parent
                const syntheticRow: TableRecord = {
                    [relatedAlias]: relatedData
                }

                // Copy any nested relation data from the original row
                for (const nestedRelationName of Object.keys(
                    config.include as Record<string, unknown>
                )) {
                    const nestedAlias: string = `${relatedAlias}_${nestedRelationName}`
                    if (row[nestedAlias]) {
                        syntheticRow[nestedAlias] = row[nestedAlias]
                    }
                }

                const nestedResults = flatToHierarchical(
                    schema,
                    [syntheticRow],
                    getTableName(schema[config.table as keyof TSchema]),
                    config.table as string,
                    relatedAlias,
                    config as QueryConfig<TSchema, AnyPgTable>
                )
                processedRelated = nestedResults[0] || relatedData
            }

            if (fkInfo.isOneToMany) {
                // One-to-many: add to array if not already present
                const relationArray = parentEntry[relationName] as TableRecord[]
                const processedRelatedRecord = processedRelated as TableRecord
                const existingIndex = relationArray.findIndex(
                    (item: TableRecord) => item.id === processedRelatedRecord.id
                )
                if (existingIndex === -1) {
                    relationArray.push(processedRelatedRecord)
                }
            } else {
                // Many-to-one: set as single object
                parentEntry[relationName] = processedRelated
            }
        }
    }

    // Apply order, limit, and offset to one-to-many relations after grouping
    for (const parentEntry of parentMap.values()) {
        for (const [relationName, relationConfig] of Object.entries(
            query.include
        )) {
            const config: {
                table: string
                many?: boolean
                limit?: number
                offset?: number
                orderBy?: OrderByConfig<AnyPgTable>
                on?: string | Partial<Record<string, string>>
            } =
                typeof relationConfig === "string"
                    ? { table: relationConfig }
                    : (relationConfig as {
                          table: string
                          many?: boolean
                          limit?: number
                          offset?: number
                          orderBy?: OrderByConfig<AnyPgTable>
                          on?: string | Partial<Record<string, string>>
                      })

            const fkInfo = getFKInfo(schema, parentTableKey, config)

            if (
                fkInfo.isOneToMany &&
                Array.isArray(parentEntry[relationName])
            ) {
                let relationArray = parentEntry[relationName] as TableRecord[]

                const hasExplicitOrder = config.orderBy !== undefined

                // Always apply order, defaulting to 'createdAt asc' if no explicit order is provided
                const orderToApply = hasExplicitOrder
                    ? config.orderBy!
                    : "createdAt"
                relationArray = applyOrderToArray(relationArray, orderToApply)

                // Apply offset and limit
                const startIndex = config.offset || 0
                const endIndex =
                    config.limit !== undefined
                        ? startIndex + config.limit
                        : undefined

                if (startIndex > 0 || endIndex !== undefined) {
                    relationArray = relationArray.slice(startIndex, endIndex)
                }

                parentEntry[relationName] = relationArray
            }
        }
    }

    return Array.from(parentMap.values())
}
