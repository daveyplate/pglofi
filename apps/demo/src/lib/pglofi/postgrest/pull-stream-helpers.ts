import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import { rxDb, sendToPullStream } from "@/lib/pglofi/rxdb/rxdb"
import type { AnyRelationConfig, QueryConfig } from "../shared/lofi-query-types"

/**
 * Extracts and collects related documents from a single parent document.
 * Groups related documents by table name for efficient batch processing.
 */
function extractRelatedDocs<TSchema extends Record<string, AnyPgTable>>(
    schema: TSchema,
    // biome-ignore lint/suspicious/noExplicitAny: Complex generic typing with includes
    doc: any,
    relationName: string,
    relationConfig: string | AnyRelationConfig<TSchema, AnyPgTable>,
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
    const relatedTableName = getTableName(schema[config.table])
    const relatedData = doc[relationName]

    if (!relatedData) return

    // Normalize to array for consistent handling
    const relatedDocs = Array.isArray(relatedData) ? relatedData : [relatedData]

    if (relatedDocs.length === 0) return

    // Batch related docs by table, deduplicating by ID
    const existing = relatedDocsByTable.get(relatedTableName)
    if (existing) {
        for (const relatedDoc of relatedDocs) {
            const id = relatedDoc.id
            if (id && !existing.seenIds.has(id)) {
                existing.seenIds.add(id)
                existing.docs.push(relatedDoc)
            }
        }
    } else {
        const seenIds = new Set<string>()
        const uniqueDocs = []
        for (const relatedDoc of relatedDocs) {
            const id = relatedDoc.id
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
 * Pushes documents to RxDB pullStream, filtering out stale updates.
 * Only documents with updatedAt greater than existing documents are pushed.
 * @param tableName - The name of the table/collection
 * @param rows - Array of documents to push
 * @throws Error if pullStream operations fail
 */
export async function pushToPullStream(
    tableName: string,
    rows: { [x: string]: unknown }[]
): Promise<void> {
    if (rows.length === 0) return

    if (!rxDb) throw new Error("Database not initialized")

    const collection = rxDb[tableName]
    const ids = rows.map((row) => row.id).filter(Boolean)
    const existingDocs = await collection.storageInstance.findDocumentsById(
        ids as string[],
        true
    )

    const filteredRows = rows.filter((row) => {
        const existingDoc = existingDocs.find((doc) => doc.id === row.id)

        if (!existingDoc) {
            return true
        }

        if (existingDoc._deleted) {
            return false
        }

        if (existingDoc.isPending) {
            return false
        }

        if (existingDoc.updatedAt === row.updatedAt && !row._deleted) {
            console.log("existingDoc", existingDoc.updatedAt, row.updatedAt)

            return false
        }

        return true
    })

    if (filteredRows.length === 0) {
        return
    }

    sendToPullStream(tableName, {
        checkpoint: {},
        documents: filteredRows
    })
}

/**
 * Recursively sends data to RxDB pullStreams for local sync.
 * Extracts nested includes and sends each table's data to its respective pullStream.
 * This enables offline-first functionality by keeping local RxDB in sync with remote data.
 */
export function sendToPullStreams<
    TSchema extends Record<string, AnyPgTable>,
    TCurrentTable extends AnyPgTable
>(
    schema: TSchema,
    // biome-ignore lint/suspicious/noExplicitAny: Complex generic typing with includes
    data: any[],
    tableName: string,
    query?: QueryConfig<TSchema, TCurrentTable>
): void {
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

    // Send cleaned parent data to its pullStream
    try {
        pushToPullStream(tableName, cleanedData)
    } catch (error) {
        console.error(`Error writing to ${tableName} pullStream:`, error)
    }

    // Recursively process related documents (batched by table)
    for (const [relatedTableName, { docs, config }] of relatedDocsByTable) {
        sendToPullStreams(schema, docs, relatedTableName, config)
    }
}
