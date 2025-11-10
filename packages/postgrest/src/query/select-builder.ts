import type { AnyRelationConfig, QueryConfig } from "@pglofi/core"
import { getFKInfo } from "@pglofi/core"
import type { AnyPgTable } from "drizzle-orm/pg-core"

/**
 * Builds a single include clause for PostgREST select string.
 * Format: relationName:tableName!fk_column_name(columns)
 */
function buildIncludeClause<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    parentTableKey: keyof TSchema,
    relationName: string,
    relationConfig: string | AnyRelationConfig<TSchema, keyof TSchema>
): string {
    const config =
        typeof relationConfig === "string"
            ? { table: relationConfig }
            : relationConfig
    const fkInfo = getFKInfo(schema, parentTableKey, config)

    const nestedSelectString = config.include
        ? `*,${Object.entries(config.include)
              .map(([name, nestedConfig]) =>
                  buildIncludeClause(schema, config.table, name, nestedConfig)
              )
              .join(",")}`
        : "*"

    // PostgREST Format: relationName:tableName!fk_column_name(columns)
    // Note: Filters, order, limit, and offset are applied via query parameters (not in select string)
    return `${relationName}:${fkInfo.foreignTable}!${fkInfo.localColumn}(${nestedSelectString})`
}

/**
 * Builds PostgREST select string from query config.
 * Returns "*" for simple queries, or "*,...includes..." for queries with relations.
 */
export function buildSelectString<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema
>(
    schema: TSchema,
    tableKey: TTableKey,
    query?: QueryConfig<TSchema, TTableKey>
): string {
    if (!query?.include) return "*"

    const includes = Object.entries(query.include).map(([name, config]) =>
        buildIncludeClause(schema, tableKey, name, config)
    )

    return `*,${includes.join(",")}`
}
