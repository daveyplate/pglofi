import { getEnvVar, type LofiPlugin } from "@pglofi/core"
import type { QueryClient } from "@tanstack/query-core"
import { sync } from "./plugin/sync"
import { write } from "./plugin/write"

type PostgrestPluginOptions = {
    dbURL?: string
    queryClient?: QueryClient
}

export function postgrestPlugin(options?: PostgrestPluginOptions) {
    // Fallback to environment variables if not provided
    const dbURL =
        options?.dbURL ??
        getEnvVar("NEXT_PUBLIC_NEON_DATA_API_URL") ??
        getEnvVar("VITE_NEON_DATA_API_URL")

    return {
        sync: (schema, tableKey, config) =>
            sync(schema, tableKey, config, options?.queryClient, dbURL),
        write: (schema, tableKey, operation, id, values) =>
            write(schema, tableKey, operation, id, values, dbURL)
    } as LofiPlugin
}
