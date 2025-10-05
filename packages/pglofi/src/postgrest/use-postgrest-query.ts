import { skipToken, useQuery } from "@tanstack/react-query"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"

import type { InferQueryResult, QueryConfig } from "../shared/lofi-query-types"
import { applyPostgrestFilters } from "./include-filters"
import { postgrest } from "./postgrest"
import { sendToPullStreams } from "./pull-stream-helpers"
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

    const tableName = tableKey ? getTableName(schema[tableKey]) : null
    const selectString = tableKey
        ? buildSelectString(schema, tableKey, query)
        : "*"

    return useQuery({
        queryKey: tableName
            ? [`pglofi:${tableName}:query`, JSON.stringify(query)]
            : [],
        queryFn: !tableName
            ? skipToken
            : async () => {
                  let queryBuilder = postgrest
                      .from(tableName)
                      .select(selectString)
                  queryBuilder = applyPostgrestFilters(queryBuilder, query)

                  const { data, error } = await queryBuilder
                  if (error) throw error

                  sendToPullStreams(schema, data, tableName, query)

                  return data as unknown as TQueryResult[]
              }
    })
}
