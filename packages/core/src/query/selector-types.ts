import type { AnyPgTable } from "drizzle-orm/pg-core"

// Helper type to get column names from a table
type ColumnNames<TTable extends AnyPgTable> = keyof TTable["_"]["columns"] &
    string

// All supported comparison operators (SQL style)
export type ComparisonOperator =
    | "eq" // Equal
    | "neq" // Not equal
    | "gt" // Greater than
    | "gte" // Greater than or equal
    | "lt" // Less than
    | "lte" // Less than or equal
    | "like" // Pattern matching (case-sensitive) - PostgreSQL extension
    | "ilike" // Pattern matching (case-insensitive) - PostgreSQL extension
    | "in" // In array

// Comparison condition types (SQL style)
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

// Strict comparison condition that ensures no extra properties
export type StrictComparisonCondition<TValue, T> = T extends { eq: TValue }
    ? keyof T extends "eq"
        ? T
        : never
    : T extends { neq: TValue }
      ? keyof T extends "neq"
          ? T
          : never
      : T extends { gt: TValue }
        ? keyof T extends "gt"
            ? T
            : never
        : T extends { gte: TValue }
          ? keyof T extends "gte"
              ? T
              : never
          : T extends { lt: TValue }
            ? keyof T extends "lt"
                ? T
                : never
            : T extends { lte: TValue }
              ? keyof T extends "lte"
                  ? T
                  : never
              : T extends { like: string }
                ? keyof T extends "like"
                    ? T
                    : never
                : T extends { ilike: string }
                  ? keyof T extends "ilike"
                      ? T
                      : never
                  : T extends { in: TValue[] }
                    ? keyof T extends "in"
                        ? T
                        : never
                    : never

// Logical operators (SQL style)
export type LogicalOperator = "and" | "or" | "not" | "nor"

// Base where config (column conditions)
type BaseWhereConfig<TTable extends AnyPgTable> = {
    [K in ColumnNames<TTable>]?:
        | TTable["_"]["columns"][K]["_"]["data"]
        | ComparisonCondition<TTable["_"]["columns"][K]["_"]["data"]>
        | undefined
}

// Strict base where config that validates comparison conditions
type StrictBaseWhereConfig<TTable extends AnyPgTable, T> = keyof T extends
    | ColumnNames<TTable>
    | undefined
    ? {
          [K in keyof T]: K extends ColumnNames<TTable>
              ? T[K] extends TTable["_"]["columns"][K]["_"]["data"] | undefined
                  ? T[K]
                  : T[K] extends
                          | ComparisonCondition<
                                TTable["_"]["columns"][K]["_"]["data"]
                            >
                          | undefined
                    ? T[K]
                    : T[K] extends object
                      ? StrictComparisonCondition<
                            TTable["_"]["columns"][K]["_"]["data"],
                            T[K]
                        >
                      : never
              : never
      }
    : T

// Where clause with optional logical operators (SQL style)
export type WhereConfig<TTable extends AnyPgTable> =
    | BaseWhereConfig<TTable>
    | {
          and?: WhereConfig<TTable>[]
      }
    | {
          or?: WhereConfig<TTable>[]
      }
    | {
          not?: WhereConfig<TTable>
      }
    | {
          nor?: WhereConfig<TTable>[]
      }

// Helper type that ensures no excess properties in where config
type NoExcessWhereProperties<
    T,
    TTable extends AnyPgTable
> = T extends BaseWhereConfig<TTable>
    ? keyof T extends ColumnNames<TTable> | undefined
        ? StrictBaseWhereConfig<TTable, T>
        : never
    : T extends { and: infer A }
      ? A extends WhereConfig<TTable>[]
          ? { and: StrictWhereConfig<TTable, A[number]>[] }
          : never
      : T extends { or: infer O }
        ? O extends WhereConfig<TTable>[]
            ? { or: StrictWhereConfig<TTable, O[number]>[] }
            : never
        : T extends { not: infer N }
          ? N extends WhereConfig<TTable>
              ? { not: StrictWhereConfig<TTable, N> }
              : never
          : T extends { nor: infer N }
            ? N extends WhereConfig<TTable>[]
                ? { nor: StrictWhereConfig<TTable, N[number]>[] }
                : never
            : never

// Strict version that enforces exact WhereConfig shape
export type StrictWhereConfig<
    TTable extends AnyPgTable,
    T
> = NoExcessWhereProperties<T, TTable>

// Legacy type alias for backwards compatibility during migration
export type SelectorConfig<TTable extends AnyPgTable> = WhereConfig<TTable>

// Helper to check if a where config is a logical operator
export function isLogicalOperator(
    whereConfig: unknown
): whereConfig is
    | { and: WhereConfig<AnyPgTable>[] }
    | { or: WhereConfig<AnyPgTable>[] }
    | { not: WhereConfig<AnyPgTable> }
    | { nor: WhereConfig<AnyPgTable>[] } {
    return (
        typeof whereConfig === "object" &&
        whereConfig !== null &&
        ("and" in whereConfig ||
            "or" in whereConfig ||
            "not" in whereConfig ||
            "nor" in whereConfig)
    )
}

// Helper to normalize where conditions (convert shorthand to explicit format)
export function normalizeSelectorCondition<TValue>(
    condition: TValue | ComparisonCondition<TValue>
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
    }

    // Default: treat as equality (implicit eq)
    return { eq: condition as TValue }
}

// Helper to get the operator and value from a normalized condition
export function getOperatorAndValue<TValue>(
    normalized: ComparisonCondition<TValue>
): {
    operator: ComparisonOperator
    value: TValue | TValue[] | string | boolean | number | [number, number]
} {
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

    // Fallback
    throw new Error("Invalid comparison condition")
}
