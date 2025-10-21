import { useStore } from "@nanostores/react"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useMemo } from "react"
import type { QueryConfig } from "../shared/lofi-query-types"
import { createPostgrestQueryStore } from "./postgrest-query-store"

/**
 * React hook wrapper for Postgrest queries.
 * Creates or retrieves a cached store for the given query and subscribes to it.
 */
export function usePostgrestQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQuery extends QueryConfig<TSchema, TSchema[TTableKey]>
>(
    schema: TSchema,
    tableKey?: TTableKey | null | 0 | false | "",
    query: TQuery = {} as TQuery
) {
    // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
    const store = useMemo(
        () => createPostgrestQueryStore(schema, tableKey, query),
        [tableKey, JSON.stringify(query)]
    )

    // Subscribe to the store with React
    return useStore(store)
}
