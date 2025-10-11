import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import useSWR from "swr"

import { transformPostgrestResponse } from "../shared/column-mapping"
import type { InferQueryResult, QueryConfig } from "../shared/lofi-query-types"
import { applyPostgrestFilters } from "./include-filters"
import { postgrest } from "./postgrest"
import { buildSelectString } from "./select-builder"

export function usePostgrestQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQuery extends QueryConfig<TSchema, TSchema[TTableKey]>
>(
    schema: TSchema,
    tableKey?: TTableKey | null | 0 | false | "",
    query: TQuery = {} as TQuery
) {
    type TQueryResult = InferQueryResult<TSchema, TTableKey, TQuery>

    const table = tableKey ? schema[tableKey] : null
    const tableName = table ? getTableName(table) : null
    const selectString = tableKey
        ? buildSelectString(schema, tableKey, query)
        : "*"

    return useSWR(
        () =>
            tableName && table
                ? `pglofi:${tableName}:query:${JSON.stringify(query)}`
                : null,
        !tableName || !table
            ? null
            : async () => {
                  let queryBuilder = postgrest
                      .from(tableName)
                      .select(selectString)
                  queryBuilder = applyPostgrestFilters(
                      queryBuilder,
                      query,
                      table,
                      schema
                  )

                  const { data, error } = await queryBuilder
                  if (error) throw error

                  const transformedData = transformPostgrestResponse(
                      schema,
                      table,
                      data as unknown as Record<string, unknown>[],
                      query.include
                  )

                  return transformedData as TQueryResult[]
              }
    )
}
