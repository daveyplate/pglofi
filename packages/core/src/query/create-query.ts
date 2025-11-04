import { BaseQueryBuilder } from "@tanstack/db"
import { type AnyUpdater, Store } from "@tanstack/store"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { SchemaCollections } from "../utils/schema-filter"
import type { QueryConfig } from "./query-types"

export type QueryResult = {
    isPending: boolean
    data?: unknown[] | null
    error?: Error
    refetch?: () => void
}

export type QueryStore = Store<QueryResult, AnyUpdater>

const queryStores = new Map<string, QueryStore>()

export function createQuery<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQuery extends QueryConfig<TSchema, TTableKey>
>(
    schema: TSchema,
    collections: SchemaCollections<TSchema>,
    tableKey?: TTableKey | null | 0 | false | "",
    config?: TQuery
): QueryStore {
    const query = new BaseQueryBuilder()

    if (queryStores.has("test")) {
        return queryStores.get("test") as QueryStore
    }

    const store = new Store<QueryResult, AnyUpdater>({
        isPending: true
    })

    queryStores.set("test", store)

    return store
}
