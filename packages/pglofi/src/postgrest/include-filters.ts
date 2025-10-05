import type { PostgrestFilterBuilder } from "@supabase/postgrest-js"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { QueryConfig } from "../shared/lofi-query-types"
import { normalizeOrderByConfig } from "../shared/order-helpers"
import { applyLimitOffset, applyWhereConditions } from "./query-builder-helpers"

/**
 * Applies filters (where, orderBy, limit, offset) to a PostgREST query.
 * Works for both root queries and nested includes.
 *
 * @param queryBuilder - The PostgREST query builder
 * @param config - Query configuration with where, orderBy, limit, offset, and include
 * @param table - The Drizzle table for column mapping
 * @param schema - The schema for resolving nested table references
 * @param relationName - Optional relation name for nested includes (omit for root queries)
 */
export function applyPostgrestFilters<
    TSchema extends Record<string, AnyPgTable>
>(
    // biome-ignore lint/suspicious/noExplicitAny: Supabase query builder type
    queryBuilder: PostgrestFilterBuilder<any, any, any, any>,
    // biome-ignore lint/suspicious/noExplicitAny: Supabase query builder type
    config: QueryConfig<any, any>,
    table?: AnyPgTable,
    schema?: TSchema,
    relationName?: string
) {
    let builder = queryBuilder
    if (config.where) {
        builder = applyWhereConditions(
            builder,
            config.where,
            relationName,
            table
        )
    }

    // Apply order
    if (config.orderBy) {
        const orders = normalizeOrderByConfig(config.orderBy, table)
        for (const { column, ascending } of orders) {
            builder = relationName
                ? builder.order(column, {
                      referencedTable: relationName,
                      ascending
                  })
                : builder.order(column, { ascending })
        }
    }

    // Apply limit and/or offset
    builder = applyLimitOffset(
        builder,
        config.limit,
        config.offset,
        relationName ? { referencedTable: relationName } : undefined
    )

    // Recursively handle nested includes
    if (config.include && schema) {
        for (const [nestedName, nestedConfig] of Object.entries(
            config.include
        )) {
            const nestedConfigObj =
                typeof nestedConfig === "string"
                    ? { table: nestedConfig }
                    : nestedConfig

            const fullRelationName = relationName
                ? `${relationName}.${nestedName}`
                : nestedName

            // Resolve the nested table from schema
            const nestedTable = schema[nestedConfigObj.table]

            builder = applyPostgrestFilters(
                builder,
                nestedConfigObj,
                nestedTable,
                schema,
                fullRelationName
            )
        }
    }

    return builder
}
