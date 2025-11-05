import {
    createLofi as createLofiCore,
    filterTableSchema,
    type InferQueryResult,
    type LofiConfig,
    type QueryConfig,
    type QueryResult,
    type SchemaCollections,
    type TableKey,
    type TablesOnly
} from "@pglofi/core"
import { useQuery as useQueryPrimitive } from "./hooks/use-query"

export async function createLofi<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
) {
    // Call the core createLofi
    const lofi = await createLofiCore(config)

    // Get the filtered schema (only tables, not other schema exports)
    const sanitizedSchema = filterTableSchema(config.schema)
    const collections = lofi.collections as SchemaCollections<TSchema>

    // Create a useQuery method that has access to schema and collections
    function useQuery<
        TTableKey extends TableKey<TSchema>,
        TQueryConfig extends QueryConfig<TablesOnly<TSchema>, TTableKey>
    >(
        tableKey?: TTableKey | null | 0 | false | "",
        query?: TQueryConfig
    ): QueryResult<
        InferQueryResult<TablesOnly<TSchema>, TTableKey, TQueryConfig>[]
    > {
        return useQueryPrimitive<TablesOnly<TSchema>, TTableKey, TQueryConfig>(
            sanitizedSchema,
            collections,
            tableKey,
            query
        )
    }

    // Return all original properties plus useQuery
    return {
        ...lofi,
        useQuery
    }
}
