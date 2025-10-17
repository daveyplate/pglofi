import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import useSWR from "swr"

import { transformPostgrestResponse } from "../shared/column-mapping"
import type { InferQueryResult, QueryConfig } from "../shared/lofi-query-types"
import { applyPostgrestFilters } from "./include-filters"
import { getPostgrest } from "./postgrest"
import { sendToPullStreams } from "./pull-stream-helpers"
import { buildSelectString } from "./select-builder"

const MAX_PAGE_SIZE = 100

/**
 * Calculate page batches to fetch all data up to the current page.
 * For example, if skip=205 and limit=5:
 * - Fetch: skip 0 limit 100, skip 100 limit 100, skip 200 limit 5, skip 205 limit 5
 * - Return only the last one (skip 205 limit 5) as the actual data
 */
function calculatePageBatches(skip: number, limit: number) {
    const batches: Array<{ skip: number; limit: number; isActual: boolean }> =
        []

    // Calculate batches for previous pages (up to but not including the actual query)
    let currentSkip = 0
    while (currentSkip < skip) {
        const batchLimit = Math.min(MAX_PAGE_SIZE, skip - currentSkip)
        batches.push({ skip: currentSkip, limit: batchLimit, isActual: false })
        currentSkip += batchLimit
    }

    // Add the actual query batch
    batches.push({ skip, limit, isActual: true })

    return batches
}

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
                  const postgrest = getPostgrest()

                  // Determine if we need to fetch multiple pages
                  const skip = query.skip ?? 0
                  const limit = query.limit ?? MAX_PAGE_SIZE

                  // If skip is 0 or undefined, just fetch normally
                  if (skip === 0) {
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

                  // Calculate all page batches to fetch
                  const batches = calculatePageBatches(skip, limit)

                  // Fetch all batches in parallel
                  const results = await Promise.all(
                      batches.map(async (batch) => {
                          const batchQuery = {
                              ...query,
                              skip: batch.skip,
                              limit: batch.limit
                          }

                          let queryBuilder = postgrest
                              .from(tableName)
                              .select(selectString)
                          queryBuilder = applyPostgrestFilters(
                              queryBuilder,
                              batchQuery,
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

                          return {
                              data: transformedData,
                              isActual: batch.isActual
                          }
                      })
                  )

                  // Push all page results to pullstream (including the actual query)
                  for (const result of results) {
                      if (result.data.length > 0) {
                          sendToPullStreams(
                              schema,
                              result.data,
                              tableName,
                              query
                          )
                      }
                  }

                  // Return only the actual query result
                  const actualResult = results.find((r) => r.isActual)
                  return (actualResult?.data || []) as TQueryResult[]
              },
        { focusThrottleInterval: 30000 }
    )
}
