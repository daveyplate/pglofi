import type { PostgrestFilterBuilder } from "@supabase/postgrest-js"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { QueryConfig } from "../shared/lofi-query-types"
import { normalizeSortConfig } from "../shared/order-helpers"
import {
    applyLimitSkip,
    applySelectorConditions
} from "./query-builder-helpers"

/**
 * Applies filters (selector, sort, limit, skip) to a PostgREST query.
 * Works for both root queries and nested includes.
 *
 * @param queryBuilder - The PostgREST query builder
 * @param config - Query configuration with selector, sort, limit, skip, and include
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
    if (config.selector) {
        builder = applySelectorConditions(
            builder,
            config.selector,
            relationName,
            table
        )
    }

    // Apply sort, defaulting to 'id asc' if no explicit sort is provided
    // Always ensure 'id' is included as a secondary sort key for stable ordering
    const hasExplicitSort = config.sort !== undefined
    const orders = hasExplicitSort
        ? normalizeSortConfig(config.sort!, table, true)
        : [{ column: "id", ascending: true, stringSort: undefined }]

    for (const { column, ascending } of orders) {
        builder = relationName
            ? builder.order(column, {
                  referencedTable: relationName,
                  ascending
              })
            : builder.order(column, { ascending })
    }

    // Apply limit and/or skip
    builder = applyLimitSkip(
        builder,
        config.limit,
        config.skip,
        relationName ? { referencedTable: relationName } : undefined
    )

    // Recursively handle nested includes
    if (config.include && schema) {
        for (const [nestedName, nestedConfig] of Object.entries(
            config.include
        )) {
            const nestedConfigObj =
                typeof nestedConfig === "string"
                    ? { from: nestedConfig }
                    : nestedConfig

            const fullRelationName = relationName
                ? `${relationName}.${nestedName}`
                : nestedName

            // Resolve the nested table from schema
            const nestedTable = schema[nestedConfigObj.from]

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
