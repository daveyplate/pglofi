import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { pullStreamsStore } from "../database/create-replications"
import type { AnyRelationConfig, QueryConfig } from "./query-types"

/**
 * Extracts and collects related documents from a single parent document.
 * Groups related documents by table name for efficient batch processing.
 */
function extractRelatedDocs<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    // biome-ignore lint/suspicious/noExplicitAny: Complex generic typing with includes
    doc: any,
    relationName: string,
    relationConfig: string | AnyRelationConfig<TSchema, keyof TSchema>,
    relatedDocsByTable: Map<
        string,
        // biome-ignore lint/suspicious/noExplicitAny: Complex generic typing with includes
        { docs: any[]; config: any; seenIds: Set<string> }
    >
) {
    const config =
        typeof relationConfig === "string"
            ? { table: relationConfig }
            : relationConfig
    const relatedTableKey = config.table as keyof TSchema
    const relatedTableName = getTableName(schema[relatedTableKey])
    const relatedData = doc[relationName]

    if (!relatedData) return

    // Normalize to array for consistent handling
    const relatedDocs = Array.isArray(relatedData) ? relatedData : [relatedData]

    if (relatedDocs.length === 0) return

    // Batch related docs by table, deduplicating by ID
    const existing = relatedDocsByTable.get(relatedTableName)
    if (existing) {
        for (const relatedDoc of relatedDocs) {
            const id = relatedDoc.id != null ? String(relatedDoc.id) : null
            if (id && !existing.seenIds.has(id)) {
                existing.seenIds.add(id)
                existing.docs.push(relatedDoc)
            }
        }
    } else {
        const seenIds = new Set<string>()
        const uniqueDocs = []
        for (const relatedDoc of relatedDocs) {
            const id = relatedDoc.id != null ? String(relatedDoc.id) : null
            if (id && !seenIds.has(id)) {
                seenIds.add(id)
                uniqueDocs.push(relatedDoc)
            }
        }
        relatedDocsByTable.set(relatedTableName, {
            docs: uniqueDocs,
            config,
            seenIds
        })
    }
}

/**
 * Recursively sends data to pullStreams for local sync.
 * Extracts nested includes and sends each table's data to its respective pullStream.
 */
export function pushToPullStreams<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema
>(
    schema: TSchema,
    tableKey: TTableKey,
    // biome-ignore lint/suspicious/noExplicitAny: Complex generic typing with includes
    data: any[],
    query?: QueryConfig<TSchema, TTableKey>
): void {
    if (data.length === 0) return

    const pullStreams = pullStreamsStore.state
    const pullStream = pullStreams[tableKey as string]

    if (!pullStream) {
        return
    }

    // Collect related documents by table name for batching
    const relatedDocsByTable = new Map<
        string,
        // biome-ignore lint/suspicious/noExplicitAny: Complex generic typing with includes
        { docs: any[]; config: any; seenIds: Set<string> }
    >()

    // Process each document: extract includes and clean
    const cleanedData = data.map((doc) => {
        const cleaned = { ...doc }

        if (query?.include) {
            for (const [relationName, relationConfig] of Object.entries(
                query.include
            )) {
                extractRelatedDocs(
                    schema,
                    doc,
                    relationName,
                    relationConfig,
                    relatedDocsByTable
                )
                delete cleaned[relationName]
            }
        }

        return cleaned
    })

    // Format documents for pullStream: ensure id is a string and add _deleted flag
    const documents = cleanedData.map((doc) => {
        const { id, ...rest } = doc as Record<string, unknown>
        return {
            id: String(id),
            ...rest,
            _deleted: false
        }
    })

    // Push cleaned parent data to its pullStream
    pullStream.next({
        checkpoint: {},
        documents
    })

    // Recursively process related documents (batched by table)
    for (const [relatedTableName, { docs, config }] of relatedDocsByTable) {
        // Find the tableKey for the related table name
        const relatedTableKey = Object.keys(schema).find(
            (key) => getTableName(schema[key]) === relatedTableName
        ) as keyof TSchema | undefined

        if (relatedTableKey) {
            pushToPullStreams(schema, relatedTableKey, docs, config)
        }
    }
}

