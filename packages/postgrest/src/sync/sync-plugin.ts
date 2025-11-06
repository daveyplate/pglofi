import { getEnvVar, type QueryConfig } from "@pglofi/core"
import type { QueryClient } from "@tanstack/query-core"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { syncQuery } from "./sync-query"

type PostgrestSyncPluginOptions = {
    dbURL?: string
    queryClient?: QueryClient
}

export function postgrestSync(options?: PostgrestSyncPluginOptions) {
    // Fallback to environment variables if not provided
    const dbURL =
        options?.dbURL ??
        getEnvVar("NEXT_PUBLIC_NEON_DATA_API_URL") ??
        getEnvVar("VITE_NEON_DATA_API_URL")

    return {
        sync: <
            TSchema extends Record<string, AnyPgTable>,
            TTableKey extends keyof TSchema,
            TQueryConfig extends QueryConfig<TSchema, TTableKey>
        >(
            schema: TSchema,
            tableKey: TTableKey,
            config?: TQueryConfig
        ) => syncQuery(schema, tableKey, config, options?.queryClient, dbURL)
    }
}
