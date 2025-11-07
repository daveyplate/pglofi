import {
    createQuery,
    type QueryConfig,
    type StrictQueryConfig,
    type SchemaCollections
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
    config?: StrictQueryConfig<TSchema, TTableKey, TQueryConfig>,
    subscribeQueryFn?: <
        TTableKeyInner extends keyof TSchema,
        TQueryConfigInner extends QueryConfig<TSchema, TTableKeyInner>
    >(
        tableKey?: TTableKeyInner | null | 0 | false | "",
        query?: StrictQueryConfig<TSchema, TTableKeyInner, TQueryConfigInner>
    ) => () => void
) {
    const hydrated = useHydrated()

    const queryStore = createQuery(
        schema,
        collections,
        hydrated ? tableKey : null,
        config
    )

    // biome-ignore lint/correctness/useExhaustiveDependencies: schema and collections are stable
    useEffect(() => {
        if (!tableKey || !subscribeQueryFn) return

        const unsubscribe = subscribeQueryFn(tableKey, config)
        return unsubscribe
    }, [tableKey, JSON.stringify(config)])

    return useStore(queryStore)
}
