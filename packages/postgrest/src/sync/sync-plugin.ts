import type { QueryConfig } from "@pglofi/core"
import type { QueryClient } from "@tanstack/query-core"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { syncQuery } from "./sync-query"

type PostgrestSyncPluginOptions = {
    queryClient?: QueryClient
}

export function postgrestSync(options?: PostgrestSyncPluginOptions) {
    return {
        sync: <
            TSchema extends Record<string, AnyPgTable>,
            TTableKey extends keyof TSchema,
            TQueryConfig extends QueryConfig<TSchema, TTableKey>
        >(
            schema: TSchema,
            tableKey: TTableKey,
            config?: TQueryConfig
        ) => syncQuery(schema, tableKey, config, options?.queryClient)
    }
}
