import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useEffect, useMemo } from "react"

import { sendToPullStreams } from "./postgrest/pull-stream-helpers"
import { usePostgrestQuery } from "./postgrest/use-postgrest-query"
import { useDb, useLofiConfig } from "./rxdb/rxdb"
import type { InferQueryResult, QueryConfig } from "./shared/lofi-query-types"
import { useLocalQuery } from "./tanstackdb/use-local-query"
import { useAblyChannels } from "./use-ably-channels"
import { useStaleEntities } from "./use-stale-entities"

export interface UseLofiQueryResult<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQuery
> {
    data: InferQueryResult<TSchema, TTableKey, TQuery>[] | undefined
    remoteData: InferQueryResult<TSchema, TTableKey, TQuery>[] | undefined
    isLoading: boolean
    error: Error | null
    refetch: () => Promise<void>
}

export const createLofiHooks = <TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema
) => {
    function useQuery<
        TTableKey extends keyof TSchema,
        TQuery extends QueryConfig<TSchema, TSchema[TTableKey]>
    >(
        tableKey?: TTableKey | null | 0 | false | "",
        query?: TQuery
    ): UseLofiQueryResult<TSchema, TTableKey, TQuery> {
        const db = useDb()
        const config = useLofiConfig()

        const {
            data: remoteData,
            isPending,
            isFetching,
            error,
            refetch: refetchPostgrest
        } = usePostgrestQuery(schema, db && tableKey, query)

        const { data, isLoading } = useLocalQuery(schema, db && tableKey, query)

        // Send remote data to pull streams for local sync
        // biome-ignore lint/correctness/useExhaustiveDependencies: schema is stable
        useEffect(() => {
            if (remoteData && tableKey) {
                const table = schema[tableKey]
                const tableName = getTableName(table)
                sendToPullStreams(schema, remoteData, tableName, query)
            }
        }, [remoteData])

        useStaleEntities({
            schema,
            data,
            remoteData,
            isFetching,
            tableKey,
            query
        })

        const refetch = useMemo(
            () => async () => {
                await refetchPostgrest()
            },
            [refetchPostgrest]
        )

        // Determine Ably channels and subscribe to them for real-time updates
        // Only execute if sync is set to "ably" and ablyToken is present
        const shouldUseAbly = config?.sync === "ably" && !!config?.ablyToken
        useAblyChannels(schema, shouldUseAbly ? tableKey : null, query, data)

        return {
            data,
            remoteData,
            isLoading: data?.length === 0 && (isLoading || isPending),
            error,
            refetch
        }
    }

    return { useQuery }
}

export const createPostgrestHooks = <
    TSchema extends Record<string, AnyPgTable>
>(
    schema: TSchema
) => {
    function useQuery<
        TTableKey extends keyof TSchema,
        TQuery extends QueryConfig<TSchema, TSchema[TTableKey]>
    >(tableKey?: TTableKey | null | 0 | false | "", query?: TQuery) {
        return usePostgrestQuery(schema, tableKey, query)
    }

    return { useQuery }
}
