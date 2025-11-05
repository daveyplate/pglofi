import {
    and,
    BaseQueryBuilder,
    type Context,
    eq,
    gt,
    gte,
    ilike,
    inArray,
    like,
    lt,
    lte,
    not,
    or,
    type QueryBuilder
} from "@tanstack/db"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"

import { type FKInfo, getFKInfo } from "../utils/fk-helpers"
import { applySortToArray, normalizeSortConfig } from "../utils/order-helpers"
import type { SchemaCollections } from "../utils/schema-filter"
import type { OrderByConfig, QueryConfig } from "./query-types"
import {
    getOperatorAndValue,
    isLogicalOperator,
    normalizeSelectorCondition,
    type WhereConfig
} from "./selector-types"

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
        case "eq":
            return eq(columnRef as never, value)
        case "neq":
            return not(eq(columnRef as never, value))
        case "gt":
            return gt(columnRef as never, value)
        case "gte":
            return gte(columnRef as never, value)
        case "lt":
            return lt(columnRef as never, value)
        case "lte":
            return lte(columnRef as never, value)
        case "like":
            return like(columnRef as never, value as string)
        case "ilike":
            return ilike(columnRef as never, value as string)
        case "in":
            return inArray(columnRef as never, value as unknown[])
        default:
            return eq(columnRef as never, value)
    }
}

/**
 * Recursively builds where expressions for TanStack DB.
 * Handles and/or/not/nor logical operators and basic column conditions.
 * All conditions at the same level are combined with implicit AND.
 */
function buildSelectorExpression(
    parentAlias: string,
    whereConfig: WhereConfig<AnyPgTable>
): (tables: Record<string, TableRecord>) => ConditionExpression {
    // Collect all condition functions (logical operators + basic columns)
    const allConditions: Array<
        (tables: Record<string, TableRecord>) => ConditionExpression
    > = []

    // Handle and logical operator
    if (
        isLogicalOperator(whereConfig) &&
        "and" in whereConfig &&
        whereConfig.and
    ) {
        const conditions = whereConfig.and.map((subWhere) =>
            buildSelectorExpression(parentAlias, subWhere)
        )
        allConditions.push((tables: Record<string, TableRecord>) => {
            const results = conditions.map((condFn) => condFn(tables))
            if (results.length === 0) return true
            if (results.length === 1) return results[0]
            return and(results[0], results[1], ...results.slice(2))
        })
    }

    // Handle or logical operator
    if (
        isLogicalOperator(whereConfig) &&
        "or" in whereConfig &&
        whereConfig.or
    ) {
        const conditions = whereConfig.or.map((subWhere) =>
            buildSelectorExpression(parentAlias, subWhere)
        )
        allConditions.push((tables: Record<string, TableRecord>) => {
            const results = conditions.map((condFn) => condFn(tables))
            if (results.length === 0) return false
            if (results.length === 1) return results[0]
            return or(results[0], results[1], ...results.slice(2))
        })
    }

    // Handle not logical operator
    if (
        isLogicalOperator(whereConfig) &&
        "not" in whereConfig &&
        whereConfig.not
    ) {
        const innerCondition = buildSelectorExpression(
            parentAlias,
            whereConfig.not
        )
        allConditions.push((tables: Record<string, TableRecord>) => {
            const result = innerCondition(tables)
            return not(result)
        })
    }

    // Handle nor logical operator (NOT OR)
    if (
        isLogicalOperator(whereConfig) &&
        "nor" in whereConfig &&
        whereConfig.nor
    ) {
        const conditions = whereConfig.nor.map((subWhere) =>
            buildSelectorExpression(parentAlias, subWhere)
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
    for (const [column, condition] of Object.entries(whereConfig)) {
        if (
            column === "and" ||
            column === "or" ||
            column === "not" ||
            column === "nor"
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

        // For one-to-many: FK is on related table, so parent.localColumn === related.foreignColumn
        // Example: profiles.id === todos.userId (FK is on todos)
        // For many-to-one: FK is on parent table, so parent.localColumn === related.foreignColumn
        // Example: todos.userId === profiles.id (FK is on todos)
        if (fkInfo.isOneToMany) {
            return eq(parent[fkInfo.localColumn], related[fkInfo.foreignColumn])
        }
        return eq(parent[fkInfo.localColumn], related[fkInfo.foreignColumn])
    }
}

/**
 * Applies order by, limit, and offset to a TanStack DB query.
 * Defaults to ordering by 'id asc' if no explicit orderBy is provided.
 */
export function applySortLimitSkip<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema
>(
    q: unknown,
    parentAlias: string,
    parentTable?: AnyPgTable,
    query?: QueryConfig<TSchema, TTableKey>
): unknown {
    let currentQuery = q

    const hasExplicitOrderBy = query?.orderBy !== undefined

    // Always apply order by, defaulting to 'id asc' if no explicit orderBy is provided
    // Always ensure 'id' is included as a secondary sort key for stable ordering
    const orders = hasExplicitOrderBy
        ? normalizeSortConfig(query.orderBy!, parentTable, true)
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
 * Note: orderBy/limit/offset for joins are applied post-processing in flatToHierarchical
 * because TanStack DB doesn't support them at query time for relations.
 */
export function buildQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema
>(
    schema: TSchema,
    collections: SchemaCollections<TSchema>,
    tableKey: TTableKey,
    query?: QueryConfig<TSchema, TTableKey>,
    parentAlias?: string,
    isRoot = true,
    existingQuery?: unknown
): QueryBuilder<Context> {
    // Derive table name from table key
    const tableName = getTableName(schema[tableKey])
    // Default parentAlias to tableName if not provided
    const alias = parentAlias ?? tableName

    // Get collection by table key (SchemaCollections uses table keys, not table names)
    const tableCollection =
        collections[tableKey as unknown as keyof typeof collections]

    if (!tableCollection) {
        throw new Error(
            `Collection not found for table key: ${String(tableKey)}`
        )
    }

    // Create base query builder or use existing query
    let currentQuery: QueryBuilder<Context>
    if (existingQuery) {
        currentQuery = existingQuery as QueryBuilder<Context>
    } else {
        const baseQuery = new BaseQueryBuilder()
        currentQuery = baseQuery.from({
            [alias]: tableCollection
        }) as QueryBuilder<Context>
    }

    // Apply where conditions (for both root and joins)
    if (query?.where) {
        const whereExpression = buildSelectorExpression(alias, query.where)
        currentQuery = currentQuery.where(
            // biome-ignore lint/suspicious/noExplicitAny: TanStack DB callback types are complex
            whereExpression as any
        ) as QueryBuilder<Context>
    }

    // Apply orderBy/limit/offset (only for root - joins handle this in post-processing)
    if (isRoot) {
        const parentTable = schema[tableKey]
        currentQuery = applySortLimitSkip(
            currentQuery,
            alias,
            parentTable,
            query
        ) as QueryBuilder<Context>
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

            const relatedCollection =
                collections[config.table as unknown as keyof typeof collections]

            if (!relatedCollection) {
                throw new Error(
                    `Collection not found for table key: ${String(config.table)}`
                )
            }

            // Get foreign key info
            const fkInfo = getFKInfo(schema, tableKey, config)

            // Create alias for the related table
            const relatedAlias = `${alias}_${relationName}`

            // Build join condition (FK relationship only)
            const joinCondition = buildJoinCondition(
                alias,
                relatedAlias,
                fkInfo
            )

            // Add join to query
            currentQuery = currentQuery.join(
                { [relatedAlias]: relatedCollection },
                // biome-ignore lint/suspicious/noExplicitAny: TanStack DB callback types are complex
                joinCondition as any,
                "left"
            ) as QueryBuilder<Context>

            // Recursively handle this relation's where conditions and nested includes
            // Pass currentQuery to continue building on the existing query
            currentQuery = buildQuery(
                schema,
                collections,
                config.table as keyof TSchema,
                config as QueryConfig<TSchema, keyof TSchema>,
                relatedAlias,
                false,
                currentQuery
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
    TTableKey extends keyof TSchema
>(
    schema: TSchema,
    flatResults: TableRecord[],
    parentTableKey: TTableKey,
    parentAlias: string,
    query?: QueryConfig<TSchema, TTableKey>
): TableRecord[] {
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
                const config =
                    typeof relationConfig === "string"
                        ? { table: relationConfig }
                        : relationConfig
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
                on?: string | Record<string, string>
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
                          on?: string | Record<string, string>
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
                    config.table as keyof TSchema,
                    relatedAlias,
                    config as QueryConfig<TSchema, keyof TSchema>
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

    // Apply order by, limit, and offset to one-to-many relations after grouping
    for (const parentEntry of parentMap.values()) {
        for (const [relationName, relationConfig] of Object.entries(
            query.include
        )) {
            const config =
                typeof relationConfig === "string"
                    ? { table: relationConfig }
                    : relationConfig

            const fkInfo = getFKInfo(schema, parentTableKey, config)

            if (
                fkInfo.isOneToMany &&
                Array.isArray(parentEntry[relationName])
            ) {
                let relationArray = parentEntry[relationName] as TableRecord[]

                const hasExplicitOrderBy = config.orderBy !== undefined

                // Always apply order by, defaulting to 'id asc' if no explicit orderBy is provided
                const orderByToApply: OrderByConfig<AnyPgTable> =
                    hasExplicitOrderBy ? config.orderBy! : ["id"]
                const relatedTable = schema[config.table as keyof TSchema]
                relationArray = applySortToArray(
                    relationArray,
                    orderByToApply,
                    relatedTable
                )

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
