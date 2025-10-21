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
import { $tableCollections } from "../db/lofi-db"
import { type FKInfo, getFKInfo } from "../shared/fk-helpers"
import type { QueryConfig, SortConfig } from "../shared/lofi-query-types"
import {
    getOperatorAndValue,
    isLogicalOperator,
    normalizeSelectorCondition,
    type SelectorConfig
} from "../shared/lofi-selector-types"
import { normalizeSortConfig } from "../shared/order-helpers"

// Type for table records with dynamic structure
type TableRecord = Record<string, unknown>

// Type for TanStack DB condition expressions
type ConditionExpression = unknown

/**
 * Applies a single comparison operator for TanStack DB queries.
 */
function applyComparisonOperator(
    columnRef: unknown,
    operator: string,
    value: unknown
): ConditionExpression {
    switch (operator) {
        case "$eq":
            return eq(columnRef as never, value)
        case "$ne":
            return not(eq(columnRef as never, value))
        case "$gt":
            return gt(columnRef as never, value)
        case "$gte":
            return gte(columnRef as never, value)
        case "$lt":
            return lt(columnRef as never, value)
        case "$lte":
            return lte(columnRef as never, value)
        case "$like":
            return like(columnRef as never, value as string)
        case "$ilike":
            return ilike(columnRef as never, value as string)
        case "$in":
            return inArray(columnRef as never, value as unknown[])
        case "$nin":
            // $nin is not in array
            return not(inArray(columnRef as never, value as unknown[]))
        case "$exists":
            // $exists checks if field is null or not
            return value === true
                ? not(eq(columnRef as never, null))
                : eq(columnRef as never, null)
        default:
            return eq(columnRef as never, value)
    }
}

/**
 * Recursively builds selector expressions for TanStack DB.
 * Handles $and/$or/$not/$nor logical operators and basic column conditions.
 * All conditions at the same level are combined with implicit AND.
 */
function buildSelectorExpression(
    parentAlias: string,
    selectorConfig: SelectorConfig<AnyPgTable>
): (tables: Record<string, TableRecord>) => ConditionExpression {
    // Collect all condition functions (logical operators + basic columns)
    const allConditions: Array<
        (tables: Record<string, TableRecord>) => ConditionExpression
    > = []

    // Handle $and logical operator
    if (
        isLogicalOperator(selectorConfig) &&
        "$and" in selectorConfig &&
        selectorConfig.$and
    ) {
        const conditions = selectorConfig.$and.map((subSelector) =>
            buildSelectorExpression(parentAlias, subSelector)
        )
        allConditions.push((tables: Record<string, TableRecord>) => {
            const results = conditions.map((condFn) => condFn(tables))
            if (results.length === 0) return true
            if (results.length === 1) return results[0]
            return and(results[0], results[1], ...results.slice(2))
        })
    }

    // Handle $or logical operator
    if (
        isLogicalOperator(selectorConfig) &&
        "$or" in selectorConfig &&
        selectorConfig.$or
    ) {
        const conditions = selectorConfig.$or.map((subSelector) =>
            buildSelectorExpression(parentAlias, subSelector)
        )
        allConditions.push((tables: Record<string, TableRecord>) => {
            const results = conditions.map((condFn) => condFn(tables))
            if (results.length === 0) return false
            if (results.length === 1) return results[0]
            return or(results[0], results[1], ...results.slice(2))
        })
    }

    // Handle $not logical operator
    if (
        isLogicalOperator(selectorConfig) &&
        "$not" in selectorConfig &&
        selectorConfig.$not
    ) {
        const innerCondition = buildSelectorExpression(
            parentAlias,
            selectorConfig.$not
        )
        allConditions.push((tables: Record<string, TableRecord>) => {
            const result = innerCondition(tables)
            return not(result)
        })
    }

    // Handle $nor logical operator (NOT OR)
    if (
        isLogicalOperator(selectorConfig) &&
        "$nor" in selectorConfig &&
        selectorConfig.$nor
    ) {
        const conditions = selectorConfig.$nor.map((subSelector) =>
            buildSelectorExpression(parentAlias, subSelector)
        )
        allConditions.push((tables: Record<string, TableRecord>) => {
            const results = conditions.map((condFn) => condFn(tables))
            if (results.length === 0) return true
            if (results.length === 1) return not(results[0])
            // NOR is NOT(a OR b OR c...)
            return not(or(results[0], results[1], ...results.slice(2)))
        })
    }

    // Handle basic column conditions
    // These are combined with implicit AND with any logical operators above
    for (const [column, condition] of Object.entries(selectorConfig)) {
        if (
            column === "$and" ||
            column === "$or" ||
            column === "$not" ||
            column === "$nor"
        )
            continue

        const normalized = normalizeSelectorCondition(condition)
        const { operator, value } = getOperatorAndValue(normalized)

        allConditions.push((tables: Record<string, TableRecord>) => {
            const table = tables[parentAlias]
            return applyComparisonOperator(table[column], operator, value)
        })
    }

    if (allConditions.length === 0) {
        return () => true as ConditionExpression
    }

    if (allConditions.length === 1) {
        return allConditions[0]
    }

    // Multiple conditions default to AND (implicit AND between all conditions)
    return (tables: Record<string, TableRecord>) => {
        const results = allConditions.map((condFn) => condFn(tables))
        return and(results[0], results[1], ...results.slice(2))
    }
}

/**
 * Applies sorting to an array of records based on sort configuration.
 * Handles multiple sort keys, null/undefined values, and string sorting strategies.
 * Always ensures 'id' is included as a secondary sort key for stable ordering.
 */
function applySortToArray<T extends TableRecord>(
    records: T[],
    sortConfig: SortConfig<AnyPgTable>,
    table?: AnyPgTable
): T[] {
    const orders = normalizeSortConfig(sortConfig, table, true)
    const sorted = [...records]

    sorted.sort((a, b) => {
        for (const { column, ascending, stringSort } of orders) {
            const aVal = a[column]
            const bVal = b[column]

            if (aVal === bVal) continue

            // Nulls sort last (Postgres default)
            if (aVal === null || aVal === undefined) return 1
            if (bVal === null || bVal === undefined) return -1

            let comparison = 0

            // Handle string sorting with strategy
            if (
                typeof aVal === "string" &&
                typeof bVal === "string" &&
                stringSort
            ) {
                if (stringSort === "locale") {
                    // Locale-aware (case-insensitive) comparison for citext
                    comparison = aVal.localeCompare(bVal)
                } else {
                    // Lexical (case-sensitive) comparison for text
                    comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
                }
            } else {
                // Non-string comparison (numbers, dates, etc.)
                comparison = aVal < bVal ? -1 : 1
            }

            if (comparison !== 0) {
                return ascending ? comparison : -comparison
            }
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
 * Applies sort, limit, and skip to a TanStack DB query.
 * Defaults to sorting by 'createdAt asc' if no explicit sort is provided.
 */
export function applySortLimitSkip<
    TSchema extends Record<string, AnyPgTable>,
    TTable extends AnyPgTable = AnyPgTable
>(
    q: unknown,
    parentAlias: string,
    parentTable?: AnyPgTable,
    query?: QueryConfig<TSchema, TTable>
): unknown {
    let currentQuery = q

    const hasExplicitSort = query?.sort !== undefined

    // Always apply sort, defaulting to 'id asc' if no explicit sort is provided
    // Always ensure 'id' is included as a secondary sort key for stable ordering
    const orders = hasExplicitSort
        ? normalizeSortConfig(query.sort!, parentTable, true)
        : [{ column: "id", ascending: true }]

    for (const { column, ascending, stringSort } of orders) {
        currentQuery = (
            currentQuery as {
                orderBy: (
                    // biome-ignore lint/suspicious/noExplicitAny: TanStack DB orderBy selector type with joins
                    selector: any,
                    direction?:
                        | "asc"
                        | "desc"
                        | {
                              direction?: "asc" | "desc"
                              stringSort?: "lexical" | "locale"
                          }
                ) => unknown
            }
        ).orderBy(
            (row: unknown) => {
                const tables = row as Record<string, TableRecord>
                return (tables[parentAlias] as TableRecord)[column]
            },
            stringSort
                ? {
                      direction: ascending ? "asc" : "desc",
                      stringSort
                  }
                : ascending
                  ? "asc"
                  : "desc"
        )
    }

    // Apply limit
    if (query?.limit !== undefined) {
        currentQuery = (
            currentQuery as { limit: (count: number) => unknown }
        ).limit(query.limit)
    }

    // Apply skip
    if (query?.skip !== undefined) {
        currentQuery = (
            currentQuery as { offset: (count: number) => unknown }
        ).offset(query.skip)
    }

    return currentQuery
}

/**
 * Builds a complete TanStack DB query with selector conditions, joins, and ordering.
 * Recursively handles nested includes and applies all filters in one pass.
 *
 * Note: sort/limit/skip for joins are applied post-processing in flatToHierarchical
 * because TanStack DB doesn't support them at query time for relations.
 */
export function buildLocalQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTable extends AnyPgTable = AnyPgTable
>(
    schema: TSchema,
    q: unknown,
    parentTableName: keyof TSchema,
    parentTableKey: keyof TSchema,
    parentAlias: string,
    query?: QueryConfig<TSchema, TTable>,
    isRoot = true
) {
    let currentQuery = q

    // Apply selector conditions (for both root and joins)
    if (query?.selector) {
        const selectorExpression = buildSelectorExpression(
            parentAlias,
            query.selector
        )
        currentQuery = (
            currentQuery as { where: (expr: unknown) => unknown }
        ).where(selectorExpression)
    }

    // Apply sort/limit/skip (only for root - joins handle this in post-processing)
    if (isRoot) {
        const parentTable = schema[parentTableKey]
        currentQuery = applySortLimitSkip(
            currentQuery,
            parentAlias,
            parentTable,
            query
        )
    }

    // Build joins recursively
    if (query?.include) {
        for (const [relationName, relationConfig] of Object.entries(
            query.include
        )) {
            const config =
                typeof relationConfig === "string"
                    ? { from: relationConfig }
                    : relationConfig

            const relatedTable = schema[config.from]
            const relatedTableName = getTableName(relatedTable)
            const relatedCollection = $tableCollections.get()[relatedTableName]

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

            // Recursively handle this relation's selector conditions and nested includes
            currentQuery = buildLocalQuery(
                schema,
                currentQuery,
                relatedTableName,
                config.from,
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
 * Groups related data by parent ID and applies limits/skips to one-to-many relations.
 */
export function flatToHierarchical<
    TSchema extends Record<string, AnyPgTable>,
    TTable extends AnyPgTable = AnyPgTable
>(
    schema: TSchema,
    flatResults: TableRecord[],
    parentTableName: string,
    parentTableKey: keyof TSchema,
    parentAlias: string,
    query?: QueryConfig<TSchema, TTable>
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
                    from: string
                    many?: boolean
                    localField?: string
                    foreignField?: string
                } =
                    typeof relationConfig === "string"
                        ? { from: relationConfig }
                        : (relationConfig as {
                              from: string
                              many?: boolean
                              localField?: string
                              foreignField?: string
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
                from: string
                include?: unknown
                selector?: unknown
                many?: boolean
                limit?: number
                skip?: number
                sort?: SortConfig<AnyPgTable>
                localField?: string
                foreignField?: string
            } =
                typeof relationConfig === "string"
                    ? { from: relationConfig }
                    : (relationConfig as {
                          from: string
                          include?: unknown
                          selector?: unknown
                          many?: boolean
                          limit?: number
                          skip?: number
                          sort?: SortConfig<AnyPgTable>
                          localField?: string
                          foreignField?: string
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
                    getTableName(schema[config.from as keyof TSchema]),
                    config.from as string,
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

    // Apply sort, limit, and skip to one-to-many relations after grouping
    for (const parentEntry of parentMap.values()) {
        for (const [relationName, relationConfig] of Object.entries(
            query.include
        )) {
            const config: {
                from: string
                many?: boolean
                limit?: number
                skip?: number
                sort?: SortConfig<AnyPgTable>
                localField?: string
                foreignField?: string
            } =
                typeof relationConfig === "string"
                    ? { from: relationConfig }
                    : (relationConfig as {
                          from: string
                          many?: boolean
                          limit?: number
                          skip?: number
                          sort?: SortConfig<AnyPgTable>
                          localField?: string
                          foreignField?: string
                      })

            const fkInfo = getFKInfo(schema, parentTableKey, config)

            if (
                fkInfo.isOneToMany &&
                Array.isArray(parentEntry[relationName])
            ) {
                let relationArray = parentEntry[relationName] as TableRecord[]

                const hasExplicitSort = config.sort !== undefined

                // Always apply sort, defaulting to 'id asc' if no explicit sort is provided
                // applySortToArray will ensure 'id' is included via normalizeSortConfig
                const sortToApply = hasExplicitSort ? config.sort! : ["id"]
                const relatedTable = schema[config.from as keyof TSchema]
                relationArray = applySortToArray(
                    relationArray,
                    sortToApply,
                    relatedTable
                )

                // Apply skip and limit
                const startIndex = config.skip || 0
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
