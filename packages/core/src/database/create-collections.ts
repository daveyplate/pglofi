import { type Collection, createCollection } from "@tanstack/db"
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection"
import type { MigrationStrategies, RxCollectionCreator, RxDatabase } from "rxdb"

import { collectionsStore } from "../stores"
import { filterTableSchema, type TableKey } from "../utils/schema-filter"
import type { LofiConfig } from "./lofi-config"

export async function createCollections<
    TSchema extends Record<string, unknown>
>(config: LofiConfig<TSchema>, db: RxDatabase) {
    const sanitizedSchema = filterTableSchema(config.schema)
    const schemaTableKeys = Object.keys(sanitizedSchema) as TableKey<TSchema>[]
    const collections = {} as Record<string, RxCollectionCreator>

    schemaTableKeys.forEach((tableKey) => {
        const schemaTable = sanitizedSchema[tableKey]

        const collection = {
            schema: {
                title: tableKey,
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
        } as RxCollectionCreator

        const migrationStrategies: MigrationStrategies = {}

        for (let i = 0; i < (config.version ?? 0); i++) {
            migrationStrategies[i + 1] = (oldDocumentData, collection) => {
                if (config.migrationStrategy) {
                    return config.migrationStrategy(
                        tableKey as string,
                        i + 1,
                        oldDocumentData,
                        collection
                    )
                }

                return oldDocumentData
            }
        }

        collection.migrationStrategies = migrationStrategies

        const columns = Object.keys(schemaTable) as (keyof typeof schemaTable)[]

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
                collection.schema.properties[String(column)] = isNullable
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
                collection.schema.properties[String(column)] = isNullable
                    ? {
                          anyOf: [{ type: "object" }, { type: "null" }]
                      }
                    : {
                          type: "object"
                      }
            } else {
                collection.schema.properties[String(column)] = isNullable
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
                collection.schema.required = [
                    ...collection.schema.required!,
                    String(column)
                ]
            }
        })

        collections[tableKey] = collection
    })

    await db.addCollections(collections)

    for (const tableKey of schemaTableKeys) {
        const tableCollection = createCollection(
            rxdbCollectionOptions({
                rxCollection: db[tableKey],
                startSync: true
            })
        ) as Collection

        collectionsStore.setState((prevState) => ({
            ...prevState,
            [tableKey]: tableCollection
        }))
    }
}
