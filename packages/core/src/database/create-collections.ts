import { type Collection, createCollection } from "@tanstack/db"
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection"
import { getTableName } from "drizzle-orm"
import type { MigrationStrategies, RxCollectionCreator, RxDatabase } from "rxdb"

import { collectionsStore } from "../stores"
import {
    filterTableSchema,
    type TableKey,
    type TablesOnly
} from "../utils/schema-filter"
import type { LofiConfig } from "./lofi-config"

export async function createCollections<
    TSchema extends Record<string, unknown>
>(config: LofiConfig<TSchema>, db: RxDatabase) {
    const sanitizedSchema = filterTableSchema(
        config.schema
    ) as TablesOnly<TSchema>
    const schemaTableKeys = Object.keys(sanitizedSchema) as TableKey<TSchema>[]
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

    for (const tableKey of schemaTableKeys) {
        const tableName = getTableName(sanitizedSchema[tableKey])
        const tableCollection = createCollection(
            rxdbCollectionOptions({
                rxCollection: db[tableName],
                startSync: true
            })
        ) as Collection

        collectionsStore.setState((prevState) => ({
            ...prevState,
            [tableName]: tableCollection
        }))
    }
}
