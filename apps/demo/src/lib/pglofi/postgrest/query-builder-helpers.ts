import type { PostgrestFilterBuilder } from "@supabase/postgrest-js"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import {
    getOperatorAndValue,
    isLogicalOperator,
    normalizeWhereCondition,
    type WhereConfig
} from "../shared/lofi-where-types"

// Default range limit when only offset is specified
const DEFAULT_RANGE_LIMIT = 100

/**
 * Formats a value for PostgREST's .not() method.
 * Arrays for 'in' operator need special formatting: (1,2,3)
 */
function formatValueForNegation(operator: string, value: unknown): unknown {
    if (operator === "in" && Array.isArray(value)) {
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
        case "eq":
            return builder.eq(col, value)
        case "neq":
            return builder.neq(col, value)
        case "gt":
            return builder.gt(col, value)
        case "gte":
            return builder.gte(col, value)
        case "lt":
            return builder.lt(col, value)
        case "lte":
            return builder.lte(col, value)
        case "like":
            return builder.like(col, value as string)
        case "ilike":
            return builder.ilike(col, value as string)
        case "in":
            return builder.in(col, value as unknown[])
        case "is":
            return builder.is(col, value)
        default:
            return builder.eq(col, value)
    }
}

/**
 * Applies where conditions to a PostgREST query builder recursively.
 * Handles AND/OR logical operators and negations.
 */
export function applyWhereConditions(
    // biome-ignore lint/suspicious/noExplicitAny: Supabase query builder type
    queryBuilder: PostgrestFilterBuilder<any, any, any, any>,
    whereConfig: WhereConfig<AnyPgTable>,
    prefix = ""
) {
    let builder = queryBuilder

    // Handle AND logical operator
    if (
        isLogicalOperator(whereConfig) &&
        "and" in whereConfig &&
        whereConfig.and
    ) {
        for (const subWhere of whereConfig.and) {
            if (!isLogicalOperator(subWhere)) {
                for (const [column, condition] of Object.entries(subWhere)) {
                    const normalized = normalizeWhereCondition(condition)
                    const { operator, value, isNegated } =
                        getOperatorAndValue(normalized)
                    const col = prefix ? `${prefix}.${column}` : column

                    if (isNegated) {
                        const formattedValue = formatValueForNegation(
                            operator,
                            value
                        )
                        builder = builder.not(col, operator, formattedValue)
                    } else {
                        builder = applyOperator(builder, col, operator, value)
                    }
                }
            }
        }
        return builder
    }

    // Handle OR logical operator
    if (
        isLogicalOperator(whereConfig) &&
        "or" in whereConfig &&
        whereConfig.or
    ) {
        const conditions: string[] = []
        for (const subWhere of whereConfig.or) {
            if (!isLogicalOperator(subWhere)) {
                for (const [column, condition] of Object.entries(subWhere)) {
                    const normalized = normalizeWhereCondition(condition)
                    const { operator, value, isNegated } =
                        getOperatorAndValue(normalized)
                    const col = prefix ? `${prefix}.${column}` : column

                    // For OR, build condition strings (negation syntax: not.operator.value)
                    const condStr = isNegated
                        ? `not.${col}.${operator}.${value}`
                        : `${col}.${operator}.${value}`
                    conditions.push(condStr)
                }
            }
        }
        if (conditions.length > 0) {
            builder = builder.or(conditions.join(","))
        }
        return builder
    }

    // Handle basic column conditions (default to AND)
    for (const [column, condition] of Object.entries(whereConfig)) {
        if (column === "and" || column === "or") continue

        const normalized = normalizeWhereCondition(condition)
        const { operator, value, isNegated } = getOperatorAndValue(normalized)
        const col = prefix ? `${prefix}.${column}` : column

        if (isNegated) {
            const formattedValue = formatValueForNegation(operator, value)
            builder = builder.not(col, operator, formattedValue)
        } else {
            builder = applyOperator(builder, col, operator, value)
        }
    }

    return builder
}

/**
 * Applies limit and offset to a PostgREST query builder.
 * PostgREST uses range() for pagination.
 */
export function applyLimitOffset(
    // biome-ignore lint/suspicious/noExplicitAny: Supabase query builder type
    queryBuilder: PostgrestFilterBuilder<any, any, any, any>,
    limit: number | undefined,
    offset: number | undefined,
    options?: { referencedTable?: string }
) {
    if (limit === undefined && offset === undefined) {
        return queryBuilder
    }

    const from = offset || 0

    if (offset !== undefined) {
        // PostgREST uses range() for offset
        const to =
            limit !== undefined ? from + limit - 1 : from + DEFAULT_RANGE_LIMIT
        return queryBuilder.range(from, to, options)
    }

    if (limit !== undefined) {
        // If only limit is set (no offset), use limit method
        return queryBuilder.limit(limit, options)
    }

    return queryBuilder
}
