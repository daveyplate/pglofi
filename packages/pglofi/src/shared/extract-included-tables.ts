import { getTableName } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { IncludeConfig } from "./lofi-query-types"

export function extractIncludedTables<
    TSchema extends Record<string, AnyPgTable>
>(schema: TSchema, include?: IncludeConfig<TSchema, AnyPgTable>) {
    if (!include) return []

    const tableNames: string[] = []

    for (const includeConfig of Object.values(include)) {
        if (typeof includeConfig === "string") {
            // Shorthand: { user: "profiles" }
            const tableName = getTableName(schema[includeConfig])
            tableNames.push(tableName)
        } else if (
            typeof includeConfig === "object" &&
            "from" in includeConfig
        ) {
            const tableName = getTableName(
                schema[includeConfig.from as keyof TSchema]
            )
            tableNames.push(tableName)

            // Recursively extract nested includes
            if (includeConfig.include) {
                tableNames.push(
                    ...extractIncludedTables(
                        schema,
                        includeConfig.include as IncludeConfig<
                            TSchema,
                            AnyPgTable
                        >
                    )
                )
            }
        }
    }

    return tableNames
}
