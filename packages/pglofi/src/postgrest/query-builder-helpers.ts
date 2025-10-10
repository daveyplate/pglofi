import type { PostgrestFilterBuilder } from "@supabase/postgrest-js"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { tsToSqlColumn } from "../shared/column-mapping"
import {
    getOperatorAndValue,
    isLogicalOperator,
    normalizeSelectorCondition,
    type SelectorConfig
} from "../shared/lofi-selector-types"

// Default range limit when only skip is specified
const DEFAULT_RANGE_LIMIT = 100

/**
 * Formats a value for PostgREST's .not() method.
 * Arrays for 'in' operator need special formatting: (1,2,3)
 */
function formatValueForNegation(operator: string, value: unknown): unknown {
    if (operator === "$in" && Array.isArray(value)) {
        return `(${value.join(",")})`
    }
    return value
}

/**
 * Applies a single operator to a PostgREST query builder column.
 */
function applyOperator(
    // biome-ignore lint/suspicious/noExplicitAny: Supabase query builder type
    builder: PostgrestFilterBuilder<any, any, any, any>,
    col: string,
    operator: string,
    value: unknown
) {
    switch (operator) {
        case "$eq":
            return builder.eq(col, value)
        case "$ne":
            return builder.neq(col, value)
        case "$gt":
            return builder.gt(col, value)
        case "$gte":
            return builder.gte(col, value)
        case "$lt":
            return builder.lt(col, value)
        case "$lte":
            return builder.lte(col, value)
        case "$like":
            return builder.like(col, value as string)
        case "$ilike":
            return builder.ilike(col, value as string)
        case "$in":
            return builder.in(col, value as unknown[])
        case "$nin":
            // $nin is not in array - use .not() with .in()
            return builder.not(col, "in", `(${(value as unknown[]).join(",")})`)
        case "$exists":
            // $exists checks if field is null or not
            return value === true
                ? builder.not(col, "is", null)
                : builder.is(col, null)
        default:
            return builder.eq(col, value)
    }
}

/**
 * Applies selector conditions to a PostgREST query builder recursively.
 * Handles $and/$or/$not/$nor logical operators.
 * Converts TypeScript column names to SQL column names.
 */
export function applySelectorConditions(
    // biome-ignore lint/suspicious/noExplicitAny: Supabase query builder type
    queryBuilder: PostgrestFilterBuilder<any, any, any, any>,
    selectorConfig: SelectorConfig<AnyPgTable>,
    prefix = "",
    table?: AnyPgTable
) {
    let builder = queryBuilder

    // Handle $and logical operator
    if (
        isLogicalOperator(selectorConfig) &&
        "$and" in selectorConfig &&
        selectorConfig.$and
    ) {
        for (const subSelector of selectorConfig.$and) {
            builder = applySelectorConditions(
                builder,
                subSelector,
                prefix,
                table
            )
        }
        return builder
    }

    // Handle $or logical operator
    if (
        isLogicalOperator(selectorConfig) &&
        "$or" in selectorConfig &&
        selectorConfig.$or
    ) {
        const conditions: string[] = []
        for (const subSelector of selectorConfig.$or) {
            if (!isLogicalOperator(subSelector)) {
                for (const [column, condition] of Object.entries(subSelector)) {
                    const normalized = normalizeSelectorCondition(condition)
                    const { operator, value } = getOperatorAndValue(normalized)
                    // Convert TS column name to SQL column name
                    const sqlColumn = table
                        ? tsToSqlColumn(table, column)
                        : column
                    const col = prefix ? `${prefix}.${sqlColumn}` : sqlColumn

                    // Strip $ prefix for PostgREST operators
                    const pgOperator = operator.replace("$", "")
                    const condStr = `${col}.${pgOperator}.${value}`
                    conditions.push(condStr)
                }
            }
        }
        if (conditions.length > 0) {
            builder = builder.or(conditions.join(","))
        }
        return builder
    }

    // Handle $not logical operator (negates a single selector)
    if (
        isLogicalOperator(selectorConfig) &&
        "$not" in selectorConfig &&
        selectorConfig.$not
    ) {
        // For $not, we apply all conditions with .not()
        const notSelector = selectorConfig.$not
        if (!isLogicalOperator(notSelector)) {
            for (const [column, condition] of Object.entries(notSelector)) {
                const normalized = normalizeSelectorCondition(condition)
                const { operator, value } = getOperatorAndValue(normalized)
                // Convert TS column name to SQL column name
                const sqlColumn = table ? tsToSqlColumn(table, column) : column
                const col = prefix ? `${prefix}.${sqlColumn}` : sqlColumn

                // Strip $ prefix for PostgREST operators
                const pgOperator = operator.replace("$", "")
                const formattedValue = formatValueForNegation(operator, value)
                builder = builder.not(col, pgOperator, formattedValue)
            }
        }
        return builder
    }

    // Handle $nor logical operator (NOR = NOT (a OR b))
    if (
        isLogicalOperator(selectorConfig) &&
        "$nor" in selectorConfig &&
        selectorConfig.$nor
    ) {
        // $nor is essentially NOT OR, so we negate all OR conditions
        const conditions: string[] = []
        for (const subSelector of selectorConfig.$nor) {
            if (!isLogicalOperator(subSelector)) {
                for (const [column, condition] of Object.entries(subSelector)) {
                    const normalized = normalizeSelectorCondition(condition)
                    const { operator, value } = getOperatorAndValue(normalized)
                    // Convert TS column name to SQL column name
                    const sqlColumn = table
                        ? tsToSqlColumn(table, column)
                        : column
                    const col = prefix ? `${prefix}.${sqlColumn}` : sqlColumn

                    // Strip $ prefix for PostgREST operators
                    const pgOperator = operator.replace("$", "")
                    const condStr = `${col}.${pgOperator}.${value}`
                    conditions.push(condStr)
                }
            }
        }
        if (conditions.length > 0) {
            // Use NOT with OR to create NOR
            builder = builder.not("or", `(${conditions.join(",")})`, "")
        }
        return builder
    }

    // Handle basic column conditions (default to AND)
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
        // Convert TS column name to SQL column name
        const sqlColumn = table ? tsToSqlColumn(table, column) : column
        const col = prefix ? `${prefix}.${sqlColumn}` : sqlColumn

        builder = applyOperator(builder, col, operator, value)
    }

    return builder
}

/**
 * Applies limit and skip to a PostgREST query builder.
 * PostgREST uses range() for pagination.
 */
export function applyLimitSkip(
    // biome-ignore lint/suspicious/noExplicitAny: Supabase query builder type
    queryBuilder: PostgrestFilterBuilder<any, any, any, any>,
    limit: number | undefined,
    skip: number | undefined,
    options?: { referencedTable?: string }
) {
    if (limit === undefined && skip === undefined) {
        return queryBuilder
    }

    const from = skip || 0

    if (skip !== undefined) {
        // PostgREST uses range() for skip
        const to =
            limit !== undefined ? from + limit - 1 : from + DEFAULT_RANGE_LIMIT
        return queryBuilder.range(from, to, options)
    }

    if (limit !== undefined) {
        // If only limit is set (no skip), use limit method
        return queryBuilder.limit(limit, options)
    }

    return queryBuilder
}
