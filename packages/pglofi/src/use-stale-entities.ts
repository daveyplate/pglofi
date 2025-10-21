import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { $tableCollections } from "./db/lofi-db"
import { getPostgrest } from "./postgrest/postgrest"
import { pushToPullStream } from "./postgrest/pull-stream-helpers"
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
    isValidating: boolean
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
    isValidating,
    tableKey,
    query
}: UseStaleEntitiesParams<TSchema, TTableKey, TQuery>): void {
    const [staleEntities, setStaleEntities] = useState<
        Record<string, Array<Record<string, unknown>>>
    >({})

    const [delayedRemoteData, setDelayedRemoteData] = useState(remoteData)

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDelayedRemoteData(remoteData)
        })

        return () => clearTimeout(timeout)
    }, [remoteData])

    const tableName = tableKey ? getTableName(schema[tableKey]) : null

    // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
    useEffect(() => {
        const remoteData = delayedRemoteData
        if (!remoteData || !data || isValidating || !tableName) return

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

        // if we haev any stale entities, log it
        if (Object.keys(nextStaleEntities).length > 0) {
            console.log("staleEntities", nextStaleEntities)
        }

        setStaleEntities(nextStaleEntities)
    }, [delayedRemoteData])

    const staleQueryKey = useMemo(() => {
        const entries = Object.entries(staleEntities)
            .map(([table, entities]) => ({
                table,
                ids: entities
                    .map((entity) => String((entity as { id: unknown }).id))
                    .sort()
            }))
            .filter(({ ids }) => ids.length > 0)
            .sort((a, b) => a.table.localeCompare(b.table))

        if (entries.length === 0) {
            return null
        }

        return ["pglofi:stale-entities", entries] as const
    }, [staleEntities])

    useSWR(
        staleQueryKey,
        async ([, entries]) => {
            await Promise.all(
                entries.map(async ({ table, ids }) => {
                    if (ids.length === 0) return

                    const postgrest = getPostgrest()

                    const { data, error } = await postgrest
                        .from(table)
                        .select("*,xmin")
                        .in("id", ids)

                    if (error) throw error

                    const drizzleTable = Object.values(schema).find(
                        (t) => getTableName(t) === table
                    )

                    const transformedData = drizzleTable
                        ? transformSqlRowsToTs(drizzleTable, data)
                        : data

                    if (transformedData.length > 0) {
                        pushToPullStream(table, transformedData)
                    }

                    const missingEntities = ids
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
                            $tableCollections.get()[table].get(entityId)
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
                })
            )

            return null
        },
        { focusThrottleInterval: 30000 }
    )
}
