import type { AnyPgTable } from "drizzle-orm/pg-core"

// Helper type to get column names from a table
type ColumnNames<TTable extends AnyPgTable> = keyof TTable["_"]["columns"] &
    string

// All supported comparison operators
export type ComparisonOperator =
    | "eq" // Equal
    | "neq" // Not equal
    | "gt" // Greater than
    | "gte" // Greater than or equal
    | "lt" // Less than
    | "lte" // Less than or equal
    | "like" // Pattern matching (case-sensitive)
    | "ilike" // Pattern matching (case-insensitive)
    | "in" // In array
    | "is" // Is (for null checks)

// Comparison condition types
export type ComparisonCondition<TValue> =
    | { eq: TValue }
    | { neq: TValue }
    | { gt: TValue }
    | { gte: TValue }
    | { lt: TValue }
    | { lte: TValue }
    | { like: string } // Only for string columns
    | { ilike: string } // Only for string columns
    | { in: TValue[] }
    | { is: null | boolean }
    | { not: ComparisonCondition<TValue> } // NOT wraps another condition

// Where condition for a single column (shorthand value or explicit operator)
export type WhereCondition<TValue> = TValue | ComparisonCondition<TValue>

// Logical operators for combining conditions
export type LogicalOperator = "and" | "or"

// Base where config (column conditions)
type BaseWhereConfig<TTable extends AnyPgTable> = {
    [K in ColumnNames<TTable>]?: WhereCondition<
        TTable["_"]["columns"][K]["_"]["data"]
    >
}

// Where clause with optional logical operators
export type WhereConfig<TTable extends AnyPgTable> =
    | BaseWhereConfig<TTable>
    | {
          and?: WhereConfig<TTable>[]
      }
    | {
          or?: WhereConfig<TTable>[]
      }

// Helper to check if a condition is a logical operator
export function isLogicalOperator(
    where: unknown
): where is
    | { and: WhereConfig<AnyPgTable>[] }
    | { or: WhereConfig<AnyPgTable>[] } {
    return (
        typeof where === "object" &&
        where !== null &&
        ("and" in where || "or" in where)
    )
}

// Helper to normalize where conditions (convert shorthand to explicit format)
export function normalizeWhereCondition<TValue>(
    condition: WhereCondition<TValue>
): ComparisonCondition<TValue> {
    // If it's already an object with an operator, return as-is
    if (typeof condition === "object" && condition !== null) {
        if ("eq" in condition) return condition as { eq: TValue }
        if ("neq" in condition) return condition as { neq: TValue }
        if ("gt" in condition) return condition as { gt: TValue }
        if ("gte" in condition) return condition as { gte: TValue }
        if ("lt" in condition) return condition as { lt: TValue }
        if ("lte" in condition) return condition as { lte: TValue }
        if ("like" in condition) return condition as { like: string }
        if ("ilike" in condition) return condition as { ilike: string }
        if ("in" in condition) return condition as { in: TValue[] }
        if ("is" in condition) return condition as { is: null | boolean }
        if ("not" in condition)
            return condition as { not: ComparisonCondition<TValue> }
    }

    // Default: treat as equality
    return { eq: condition as TValue }
}

// Helper to get the operator and value from a normalized condition
export function getOperatorAndValue<TValue>(
    normalized: ComparisonCondition<TValue>
): {
    operator: ComparisonOperator
    value: TValue | TValue[] | string | null | boolean
    isNegated?: boolean
    innerCondition?: ComparisonCondition<TValue>
} {
    // Handle NOT wrapper
    if ("not" in normalized) {
        const inner = getOperatorAndValue(normalized.not)
        return {
            operator: inner.operator,
            value: inner.value,
            isNegated: true,
            innerCondition: normalized.not
        }
    }

    if ("eq" in normalized) return { operator: "eq", value: normalized.eq }
    if ("neq" in normalized) return { operator: "neq", value: normalized.neq }
    if ("gt" in normalized) return { operator: "gt", value: normalized.gt }
    if ("gte" in normalized) return { operator: "gte", value: normalized.gte }
    if ("lt" in normalized) return { operator: "lt", value: normalized.lt }
    if ("lte" in normalized) return { operator: "lte", value: normalized.lte }
    if ("like" in normalized)
        return { operator: "like", value: normalized.like }
    if ("ilike" in normalized)
        return { operator: "ilike", value: normalized.ilike }
    if ("in" in normalized) return { operator: "in", value: normalized.in }
    if ("is" in normalized) return { operator: "is", value: normalized.is }

    // Fallback
    throw new Error("Invalid comparison condition")
}
