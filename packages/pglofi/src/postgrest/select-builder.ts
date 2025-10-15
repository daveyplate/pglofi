import type { AnyPgTable } from "drizzle-orm/pg-core"
import { getFKInfo } from "../shared/fk-helpers"
import type { AnyRelationConfig, QueryConfig } from "../shared/lofi-query-types"

/**
 * Builds a single include clause for PostgREST select string.
 * Format: relationName:tableName!fk_column_name(columns)
 */
function buildIncludeClause<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    parentTableKey: keyof TSchema,
    relationName: string,
    relationConfig: string | AnyRelationConfig<TSchema, AnyPgTable>
): string {
    const config =
        typeof relationConfig === "string"
            ? { from: relationConfig }
            : relationConfig
    const fkInfo = getFKInfo(schema, parentTableKey, config)

    // Build nested select string recursively, always including xmin
    const nestedSelectString = config.include
        ? `*,xmin,${Object.entries(config.include)
              .map(([name, nestedConfig]) =>
                  buildIncludeClause(schema, config.from, name, nestedConfig)
              )
              .join(",")}`
        : "*,xmin"

    // PostgREST Format: relationName:tableName!fk_column_name(columns)
    // Note: Filters, order, limit, and offset are applied via query parameters (not in select string)
    return `${relationName}:${fkInfo.foreignTable}!${fkInfo.localColumn}(${nestedSelectString})`
}

/**
 * Builds PostgREST select string from query config.
 * Returns "*,xmin" for simple queries, or "*,xmin,includes..." for queries with relations.
 * Always includes xmin for optimistic locking and version control.
 */
export function buildSelectString<
    TSchema extends Record<string, AnyPgTable>,
    TCurrentTable extends AnyPgTable
>(
    schema: TSchema,
    tableKey: keyof TSchema,
    query?: QueryConfig<TSchema, TCurrentTable>
): string {
    if (!query?.include) return "*,xmin"

    const includes = Object.entries(query.include).map(([name, config]) =>
        buildIncludeClause(schema, tableKey, name, config)
    )

    return `*,xmin,${includes.join(",")}`
}
