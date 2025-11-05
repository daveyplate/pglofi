import {
    createQuery,
    type InferQueryResult,
    type QueryConfig,
    type QueryResult,
    type SchemaCollections,
    subscribeQuery
} from "@pglofi/core"
import { useStore } from "@tanstack/react-store"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useEffect } from "react"

import { useHydrated } from "./use-hydrated"

export function useQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQueryConfig extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    collections: SchemaCollections<TSchema>,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: TQueryConfig
): QueryResult<InferQueryResult<TSchema, TTableKey, TQueryConfig>[]> {
    const hydrated = useHydrated()

    const queryStore = createQuery(
        schema,
        collections,
        hydrated ? tableKey : null,
        config
    )

    // biome-ignore lint/correctness/useExhaustiveDependencies: schema and collections are stable
    useEffect(() => {
        if (!tableKey) return

        const unsubscribe = subscribeQuery(
            schema,
            collections,
            tableKey,
            config
        )
        return unsubscribe
    }, [tableKey, JSON.stringify(config)])

    return useStore(queryStore)
}
