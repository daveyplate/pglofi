import type { AnyPgTable } from "drizzle-orm/pg-core"

// Helper type to get column names from a table
type ColumnNames<TTable extends AnyPgTable> = keyof TTable["_"]["columns"] &
    string

// All supported comparison operators (Mango Query style with $ prefix)
export type ComparisonOperator =
    | "$eq" // Equal
    | "$ne" // Not equal
    | "$gt" // Greater than
    | "$gte" // Greater than or equal
    | "$lt" // Less than
    | "$lte" // Less than or equal
    | "$like" // Pattern matching (case-sensitive) - PostgreSQL extension
    | "$ilike" // Pattern matching (case-insensitive) - PostgreSQL extension
    | "$in" // In array
    | "$nin" // Not in array
    | "$exists" // Check if field exists
    | "$type" // Check field type (for future use)
    | "$mod" // Modulo operation
    | "$regex" // Regular expression (for future use)

// Comparison condition types (Mango Query format)
export type ComparisonCondition<TValue> =
    | { $eq: TValue }
    | { $ne: TValue }
    | { $gt: TValue }
    | { $gte: TValue }
    | { $lt: TValue }
    | { $lte: TValue }
    | { $like: string } // Only for string columns
    | { $ilike: string } // Only for string columns
    | { $in: TValue[] }
    | { $nin: TValue[] }
    | { $exists: boolean }
    | { $type: string }
    | { $mod: [number, number] } // [Divisor, Remainder]
    | { $regex: string }

// Logical operators (Mango Query format with $ prefix)
export type LogicalOperator = "$and" | "$or" | "$not" | "$nor"

// Base selector config (column conditions)
type BaseSelectorConfig<TTable extends AnyPgTable> = {
    [K in ColumnNames<TTable>]?:
        | TTable["_"]["columns"][K]["_"]["data"]
        | ComparisonCondition<TTable["_"]["columns"][K]["_"]["data"]>
}

// Selector clause with optional logical operators (Mango Query format)
export type SelectorConfig<TTable extends AnyPgTable> =
    | BaseSelectorConfig<TTable>
    | {
          $and?: SelectorConfig<TTable>[]
      }
    | {
          $or?: SelectorConfig<TTable>[]
      }
    | {
          $not?: SelectorConfig<TTable>
      }
    | {
          $nor?: SelectorConfig<TTable>[]
      }

// Helper to check if a selector is a logical operator
export function isLogicalOperator(
    selector: unknown
): selector is
    | { $and: SelectorConfig<AnyPgTable>[] }
    | { $or: SelectorConfig<AnyPgTable>[] }
    | { $not: SelectorConfig<AnyPgTable> }
    | { $nor: SelectorConfig<AnyPgTable>[] } {
    return (
        typeof selector === "object" &&
        selector !== null &&
        ("$and" in selector ||
            "$or" in selector ||
            "$not" in selector ||
            "$nor" in selector)
    )
}

// Helper to normalize selector conditions (convert shorthand to explicit format)
export function normalizeSelectorCondition<TValue>(
    condition: TValue | ComparisonCondition<TValue>
): ComparisonCondition<TValue> {
    // If it's already an object with an operator, return as-is
    if (typeof condition === "object" && condition !== null) {
        if ("$eq" in condition) return condition as { $eq: TValue }
        if ("$ne" in condition) return condition as { $ne: TValue }
        if ("$gt" in condition) return condition as { $gt: TValue }
        if ("$gte" in condition) return condition as { $gte: TValue }
        if ("$lt" in condition) return condition as { $lt: TValue }
        if ("$lte" in condition) return condition as { $lte: TValue }
        if ("$like" in condition) return condition as { $like: string }
        if ("$ilike" in condition) return condition as { $ilike: string }
        if ("$in" in condition) return condition as { $in: TValue[] }
        if ("$nin" in condition) return condition as { $nin: TValue[] }
        if ("$exists" in condition) return condition as { $exists: boolean }
        if ("$type" in condition) return condition as { $type: string }
        if ("$mod" in condition) return condition as { $mod: [number, number] }
        if ("$regex" in condition) return condition as { $regex: string }
    }

    // Default: treat as equality (implicit $eq)
    return { $eq: condition as TValue }
}

// Helper to get the operator and value from a normalized condition
export function getOperatorAndValue<TValue>(
    normalized: ComparisonCondition<TValue>
): {
    operator: ComparisonOperator
    value: TValue | TValue[] | string | boolean | number | [number, number]
} {
    if ("$eq" in normalized) return { operator: "$eq", value: normalized.$eq }
    if ("$ne" in normalized) return { operator: "$ne", value: normalized.$ne }
    if ("$gt" in normalized) return { operator: "$gt", value: normalized.$gt }
    if ("$gte" in normalized)
        return { operator: "$gte", value: normalized.$gte }
    if ("$lt" in normalized) return { operator: "$lt", value: normalized.$lt }
    if ("$lte" in normalized)
        return { operator: "$lte", value: normalized.$lte }
    if ("$like" in normalized)
        return { operator: "$like", value: normalized.$like }
    if ("$ilike" in normalized)
        return { operator: "$ilike", value: normalized.$ilike }
    if ("$in" in normalized) return { operator: "$in", value: normalized.$in }
    if ("$nin" in normalized)
        return { operator: "$nin", value: normalized.$nin }
    if ("$exists" in normalized)
        return { operator: "$exists", value: normalized.$exists }
    if ("$type" in normalized)
        return { operator: "$type", value: normalized.$type }
    if ("$mod" in normalized)
        return { operator: "$mod", value: normalized.$mod }
    if ("$regex" in normalized)
        return { operator: "$regex", value: normalized.$regex }

    // Fallback
    throw new Error("Invalid comparison condition")
}
