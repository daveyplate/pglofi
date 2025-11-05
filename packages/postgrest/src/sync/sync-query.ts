import { getQuery, type InferQueryResult, type QueryConfig } from "@pglofi/core"
import { QueryClient, QueryObserver } from "@tanstack/query-core"
import type { AnyPgTable } from "drizzle-orm/pg-core"

const queryClient = new QueryClient()

export function syncQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(schema: TSchema, tableKey: TTableKey, config?: TQueryConfig) {
    type TQueryResult = InferQueryResult<TSchema, TTableKey, TQueryConfig>[]

    const queryStore = getQuery(schema, tableKey, config)

    const observer = new QueryObserver(queryClient, {
        queryKey: ["posts"],
        queryFn: () => {
            console.log("QUERY!!")
        }
    })

    const unsubscribe = observer.subscribe((result) => {
        console.log(result)
        unsubscribe()
    })

    return () => {
        unsubscribe()
    }
}
