import { useQueries } from "@tanstack/react-query"
import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useEffect, useState } from "react"

import { postgrest } from "./postgrest/postgrest"
import { pushToPullStream } from "./postgrest/pull-stream-helpers"
import { tableCollections } from "./rxdb/rxdb"
import { transformSqlRowsToTs } from "./shared/column-mapping"
import type { QueryConfig } from "./shared/lofi-query-types"

interface UseStaleEntitiesParams<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQuery
> {
    schema: TSchema
    data: unknown[] | undefined
    remoteData: unknown[] | undefined
    isFetching: boolean
    tableKey?: TTableKey | null | 0 | false | ""
    query?: TQuery
}

export function useStaleEntities<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TQuery extends QueryConfig<TSchema, TSchema[TTableKey]>
>({
    schema,
    data,
    remoteData,
    isFetching,
    tableKey,
    query
}: UseStaleEntitiesParams<TSchema, TTableKey, TQuery>): void {
    const [staleEntities, setStaleEntities] = useState<
        Record<string, Array<Record<string, unknown>>>
    >({})

    const tableName = tableKey ? getTableName(schema[tableKey]) : null

    // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
    useEffect(() => {
        if (!remoteData || !data || isFetching || !tableName) return

        // Helper to strip includes from an entity
        const stripIncludes = (
            entity: Record<string, unknown>,
            includeConfig?: TQuery extends { include: infer I } ? I : never
        ): Record<string, unknown> => {
            if (!includeConfig || typeof includeConfig !== "object") {
                return entity
            }

            const stripped = { ...entity }
            for (const relationName of Object.keys(includeConfig)) {
                delete stripped[relationName]
            }
            return stripped
        }

        // Helper to recursively collect all entities by table from data structure
        const collectEntitiesByTable = (
            entities: unknown[],
            mainTableName: string,
            includeConfig?: TQuery extends { include: infer I } ? I : never
        ): Record<string, Array<Record<string, unknown>>> => {
            const result: Record<string, Array<Record<string, unknown>>> = {}

            // Add main entities (with includes stripped)
            result[mainTableName] = entities.map((e) =>
                stripIncludes(e as Record<string, unknown>, includeConfig)
            )

            // Process includes recursively
            if (includeConfig && typeof includeConfig === "object") {
                for (const [relationName, relationConfig] of Object.entries(
                    includeConfig
                )) {
                    const config =
                        typeof relationConfig === "string"
                            ? { from: relationConfig }
                            : (relationConfig as {
                                  from: keyof TSchema
                                  include?: unknown
                              })

                    const relatedTableName = getTableName(schema[config.from])

                    // Collect nested entities
                    const nestedEntities: Array<Record<string, unknown>> = []

                    for (const entity of entities) {
                        const relatedData = (entity as Record<string, unknown>)[
                            relationName
                        ]

                        if (relatedData) {
                            if (Array.isArray(relatedData)) {
                                // One-to-many relationship
                                nestedEntities.push(...relatedData)

                                // Recursively process nested includes
                                if (config.include) {
                                    const deepNested = collectEntitiesByTable(
                                        relatedData,
                                        relatedTableName,
                                        config.include as never
                                    )
                                    // Merge deep nested results
                                    for (const [
                                        table,
                                        entities
                                    ] of Object.entries(deepNested)) {
                                        if (table !== relatedTableName) {
                                            // Skip the direct relation, already added
                                            result[table] = [
                                                ...(result[table] || []),
                                                ...entities
                                            ]
                                        }
                                    }
                                }
                            } else {
                                // Many-to-one relationship
                                nestedEntities.push(
                                    relatedData as Record<string, unknown>
                                )

                                // Recursively process nested includes
                                if (config.include) {
                                    const deepNested = collectEntitiesByTable(
                                        [relatedData],
                                        relatedTableName,
                                        config.include as never
                                    )
                                    // Merge deep nested results
                                    for (const [
                                        table,
                                        entities
                                    ] of Object.entries(deepNested)) {
                                        if (table !== relatedTableName) {
                                            // Skip the direct relation, already added
                                            result[table] = [
                                                ...(result[table] || []),
                                                ...entities
                                            ]
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (nestedEntities.length > 0) {
                        // Strip includes from nested entities
                        const strippedNested = nestedEntities.map((e) =>
                            stripIncludes(
                                e as Record<string, unknown>,
                                config.include as never
                            )
                        )

                        result[relatedTableName] = [
                            ...(result[relatedTableName] || []),
                            ...strippedNested
                        ]
                    }
                }
            }

            // Deduplicate entities by ID for each table
            for (const table of Object.keys(result)) {
                const seen = new Set<string>()
                result[table] = result[table].filter((entity) => {
                    const id = entity.id as string
                    if (seen.has(id)) return false
                    seen.add(id)
                    return true
                })
            }

            return result
        }

        // Collect all entities from both remote and local data
        const remoteEntitiesByTable = collectEntitiesByTable(
            remoteData,
            tableName,
            query?.include as never
        )

        const localEntitiesByTable = collectEntitiesByTable(
            data,
            tableName,
            query?.include as never
        )

        // Calculate stale entities for each table
        const nextStaleEntities: Record<
            string,
            Array<Record<string, unknown>>
        > = {}

        for (const [table, localEntities] of Object.entries(
            localEntitiesByTable
        )) {
            const remoteEntities = remoteEntitiesByTable[table] || []
            // Ensure all IDs are strings for comparison
            const remoteIdSet = new Set(remoteEntities.map((e) => String(e.id)))

            const stale = localEntities.filter(
                (entity) =>
                    !remoteIdSet.has(String(entity.id)) &&
                    !(entity as { isPending?: boolean }).isPending
            )

            if (stale.length > 0) {
                nextStaleEntities[table] = stale
            }
        }

        setStaleEntities(nextStaleEntities)
    }, [remoteData, isFetching])

    // Fetch stale entities from remote to check if they were deleted
    useQueries({
        queries: Object.entries(staleEntities).map(([table, entities]) => {
            const entityIds = entities.map((e) => e.id as string)
            // Find the Drizzle table from schema for column mapping
            const drizzleTable = Object.values(schema).find(
                (t) => getTableName(t) === table
            )

            return {
                queryKey: [`pglofi:${table}`, "in", entityIds.sort().join(",")],
                queryFn: async () => {
                    const { data, error } = await postgrest
                        .from(table)
                        .select("*")
                        .in("id", entityIds)

                    if (error) throw error

                    // Transform SQL column names to TypeScript property names
                    const transformedData = drizzleTable
                        ? transformSqlRowsToTs(drizzleTable, data)
                        : data

                    if (transformedData.length > 0) {
                        pushToPullStream(table, transformedData)
                    }

                    const missingEntities = entityIds
                        .filter(
                            (entityId) =>
                                !transformedData.find(
                                    (row) =>
                                        String(
                                            (row as Record<string, unknown>).id
                                        ) === entityId
                                )
                        )
                        .map((entityId) =>
                            tableCollections[table].get(entityId)
                        )
                        .filter(Boolean)

                    if (missingEntities.length > 0) {
                        pushToPullStream(
                            table,
                            missingEntities.map((entity) => ({
                                ...entity,
                                _deleted: true
                            }))
                        )
                    }

                    return transformedData
                },
                enabled: entityIds.length > 0
            }
        })
    })
}
