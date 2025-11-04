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
import { normalizeSortConfig } from "../utils/order-helpers"
import type { SchemaCollections } from "../utils/schema-filter"
import type { QueryConfig } from "./query-types"
import {
    getOperatorAndValue,
    isLogicalOperator,
    normalizeSelectorCondition,
    type SelectorConfig
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
 * Defaults to sorting by 'id asc' if no explicit sort is provided.
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
export function buildQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema
>(
    schema: TSchema,
    collections: SchemaCollections<TSchema>,
    tableKey: TTableKey,
    query?: QueryConfig<TSchema, TTableKey>,
    parentAlias?: string,
    isRoot = true
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

    // Create base query builder
    const baseQuery = new BaseQueryBuilder()
    let currentQuery = baseQuery.from({
        [alias]: tableCollection
    }) as QueryBuilder<Context>

    // Apply selector conditions (for both root and joins)
    if (query?.selector) {
        const selectorExpression = buildSelectorExpression(
            alias,
            query.selector
        )
        currentQuery = currentQuery.where(
            // biome-ignore lint/suspicious/noExplicitAny: TanStack DB callback types are complex
            selectorExpression as any
        ) as QueryBuilder<Context>
    }

    // Apply sort/limit/skip (only for root - joins handle this in post-processing)
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
                    ? { from: relationConfig }
                    : relationConfig

            const relatedCollection =
                collections[config.from as unknown as keyof typeof collections]

            if (!relatedCollection) {
                throw new Error(
                    `Collection not found for table key: ${String(config.from)}`
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

            // Recursively handle this relation's selector conditions and nested includes
            currentQuery = buildQuery(
                schema,
                collections,
                config.from as keyof TSchema,
                config as QueryConfig<TSchema, keyof TSchema>,
                relatedAlias,
                false
            )
        }
    }

    return currentQuery
}
