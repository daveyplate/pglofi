import { type Collection, createCollection } from "@tanstack/db"
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection"
import type { InferSelectModel } from "drizzle-orm"
import { getTableName } from "drizzle-orm"
import type { MigrationStrategies, RxCollectionCreator, RxDatabase } from "rxdb"
import { filterTableSchema, type TablesOnly } from "../utils/schema-filter"
import type { LofiConfig } from "./lofi-config"

// Entity type includes RxDB metadata fields
type EntityWithMetadata<T> = T & {
    id: string
    isPending?: boolean
}

export async function createCollections<
    TSchema extends Record<string, unknown>
>(
    config: LofiConfig<TSchema>,
    db: RxDatabase
): Promise<{
    collections: {
        [K in keyof TablesOnly<TSchema>]: Collection<
            EntityWithMetadata<InferSelectModel<TablesOnly<TSchema>[K]>>,
            string
        >
    }
}> {
    const sanitizedSchema = filterTableSchema(
        config.schema
    ) as TablesOnly<TSchema>
    const schemaTableKeys = Object.keys(
        sanitizedSchema
    ) as (keyof TablesOnly<TSchema>)[]
    const collections = {} as Record<string, RxCollectionCreator>

    schemaTableKeys.forEach((tableKey) => {
        const schemaTable = sanitizedSchema[tableKey]
        const tableName = getTableName(schemaTable)

        collections[tableName] = {
            schema: {
                title: tableName,
                version: config.version!,
                type: "object",
                primaryKey: "id",
                properties: {
                    id: { type: "string", maxLength: 100 },
                    isPending: { type: "boolean" },
                    xmin: { type: "string" }
                },
                required: ["id"]
            }
        }

        const migrationStrategies: MigrationStrategies = {}

        for (let i = 0; i < (config.version ?? 0); i++) {
            migrationStrategies[i + 1] = (oldDocumentData, collection) => {
                if (config.migrationStrategy) {
                    return config.migrationStrategy(
                        tableName,
                        i + 1,
                        oldDocumentData,
                        collection
                    )
                }

                return oldDocumentData
            }
        }

        collections[tableName].migrationStrategies = migrationStrategies

        const columns = Object.keys(schemaTable) as (
            | keyof typeof schemaTable
            | "id"
        )[]
        columns.forEach((column) => {
            if (column === "id") return

            const tableColumn = schemaTable[column] as {
                dataType?: string
                notNull?: boolean
                sqlName?: string
            }

            if (!tableColumn.dataType) return

            const isNullable = !tableColumn.notNull

            if (
                tableColumn.dataType === "date" ||
                tableColumn.sqlName === "citext"
            ) {
                collections[tableName].schema.properties[String(column)] =
                    isNullable
                        ? {
                              anyOf: [
                                  {
                                      type: "string"
                                  },
                                  { type: "null" }
                              ]
                          }
                        : {
                              type: "string"
                          }
            } else if (tableColumn.dataType === "json") {
                collections[tableName].schema.properties[String(column)] =
                    isNullable
                        ? {
                              anyOf: [{ type: "object" }, { type: "null" }]
                          }
                        : {
                              type: "object"
                          }
            } else {
                collections[tableName].schema.properties[String(column)] =
                    isNullable
                        ? {
                              anyOf: [
                                  { type: tableColumn.dataType },
                                  { type: "null" }
                              ]
                          }
                        : {
                              type: tableColumn.dataType
                          }
            }

            if (tableColumn.notNull) {
                collections[tableName].schema.required = [
                    ...collections[tableName].schema.required!,
                    String(column)
                ]
            }
        })
    })

    await db.addCollections(collections)

    // Create tanstackdb collections for each table key
    // Use a mapped type approach to preserve literal types
    type CollectionsReturn = {
        [K in keyof TablesOnly<TSchema>]: Collection<
            EntityWithMetadata<InferSelectModel<TablesOnly<TSchema>[K]>>,
            string
        >
    }

    const tanstackCollections = {} as CollectionsReturn

    // Helper function to create a typed collection for a specific table key
    function createTypedCollection<K extends keyof TablesOnly<TSchema>>(
        tableKey: K
    ): CollectionsReturn[K] {
        const tableName = getTableName(sanitizedSchema[tableKey])
        const tableCollection = createCollection(
            rxdbCollectionOptions({
                rxCollection: db[tableName],
                startSync: true
            })
        )
        return tableCollection as CollectionsReturn[K]
    }

    for (const tableKey of schemaTableKeys) {
        tanstackCollections[tableKey] = createTypedCollection(tableKey)
    }

    return {
        collections: tanstackCollections
    }
}
