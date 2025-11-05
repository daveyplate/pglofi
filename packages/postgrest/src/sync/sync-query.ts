import type { QueryConfig } from "@pglofi/core"
import { QueryClient, QueryObserver } from "@tanstack/query-core"
import type { AnyPgTable } from "drizzle-orm/pg-core"

const defaultQueryClient = new QueryClient()

export function syncQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    tableKey: TTableKey,
    config?: TQueryConfig,
    queryClient?: QueryClient
) {
    console.log("[PostgrestSync] syncing query", { tableKey, config })

    const client = queryClient ?? defaultQueryClient
    client.mount()

    const observer = new QueryObserver(client, {
        queryKey: ["posts"],
        queryFn: () => {
            console.log("QUERY!!")
            return []
        }
    })

    const unsubscribe = observer.subscribe((result) => {
        console.log(result)
    })

    return () => {
        console.log("[PostgrestSync] cleaning up sync for", tableKey)
        unsubscribe()
    }
}
