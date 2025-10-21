import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useEffect, useMemo } from "react"
import { useAblyChannels } from "./ably/use-ably-channels"
import { useDb, useLofiConfig } from "./db/lofi-db"
import { sendToPullStreams } from "./postgrest/pull-stream-helpers"
import { usePostgrestQuery } from "./postgrest/use-postgrest-query"
import type { InferQueryResult, QueryConfig } from "./shared/lofi-query-types"
import { useLocalQuery } from "./tanstackdb/use-local-query"
import { useStaleEntities } from "./use-stale-entities"

export interface UseLofiQueryResult<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQuery
> {
    data: InferQueryResult<TSchema, TTableKey, TQuery>[] | undefined | null
    remoteData:
        | InferQueryResult<TSchema, TTableKey, TQuery>[]
        | undefined
        | null
    isLoading: boolean
    isLoadingRemote: boolean
    error: Error | null
    refetch: () => Promise<void> | void
}

export interface UseLofiQueryOneResult<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQuery
> {
    data: InferQueryResult<TSchema, TTableKey, TQuery> | undefined
    remoteData: InferQueryResult<TSchema, TTableKey, TQuery> | undefined
    isLoading: boolean
    isLoadingRemote: boolean
    error: Error | null
    refetch: () => Promise<void> | void
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

        const { data, isLoading } = useLocalQuery(schema, db && tableKey, query)

        const {
            data: remoteData,
            loading: pgLoading,
            error
        } = usePostgrestQuery(schema, db && tableKey, query)

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
            tableKey,
            query
        })

        // const refetch = useMemo(
        //     () => async () => {
        //         await mutate()
        //     },
        //     [mutate]
        // )

        // Determine Ably channels and subscribe to them for real-time updates
        // Only execute if sync is set to "ably" and ablyToken is present
        const shouldUseAbly = config?.sync === "ably" && !!config?.ablyToken
        useAblyChannels(schema, shouldUseAbly ? tableKey : null, query, data)

        return {
            data,
            remoteData,
            isLoading: !data?.length && (isLoading || pgLoading),
            isLoadingRemote: isLoading || pgLoading,
            error,
            refetch: () => {}
        }
    }

    function useQueryOne<
        TTableKey extends keyof TSchema,
        TQuery extends QueryConfig<TSchema, TSchema[TTableKey]>
    >(
        tableKey?: TTableKey | null | 0 | false | "",
        query?: TQuery
    ): UseLofiQueryOneResult<TSchema, TTableKey, TQuery> {
        const queryWithLimit = useMemo(
            () => ({
                ...query,
                limit: 1
            }),
            [query]
        ) as TQuery

        const result = useQuery(tableKey, queryWithLimit)

        return {
            data: result.data?.[0],
            remoteData: result.remoteData?.[0],
            isLoading: result.isLoading,
            isLoadingRemote: result.isLoadingRemote,
            error: result.error,
            refetch: () => {}
        }
    }

    return { useQuery, useQueryOne }
}
