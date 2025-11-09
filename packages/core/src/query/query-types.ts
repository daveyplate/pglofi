import type { InferSelectModel } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { StrictWhereConfig, WhereConfig } from "./selector-types"

// Helper type to get column names from a table
type ColumnNames<TTable extends AnyPgTable> = keyof TTable["_"]["columns"] &
    string

// Order by configuration (SQL style)
// Can be:
// - Single object: { createdAt: "desc" }
// - Array of column names (defaults to "asc"): ["createdAt", "name"]
// - Array of objects with column and direction: [{ createdAt: "desc" }, { name: "asc" }]
export type OrderByConfig<TTable extends AnyPgTable> =
    | Partial<Record<ColumnNames<TTable>, "asc" | "desc">>
    | ColumnNames<TTable>[]
    | Partial<Record<ColumnNames<TTable>, "asc" | "desc">>[]

// Relation configuration (MongoDB $lookup style)
type RelationConfig<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TRelatedTableName extends keyof TSchema & string
> = {
    table: TRelatedTableName // The table/collection to join with
    include?: IncludeConfig<TSchema, TRelatedTableName>
    where?: WhereConfig<TSchema[TRelatedTableName]>
    limit?: number
    offset?: number
    orderBy?: OrderByConfig<TSchema[TRelatedTableName]>
} & (
    | {
          many?: false | undefined
          on?:
              | ColumnNames<TSchema[TTableKey]>
              | ColumnNames<TSchema[TRelatedTableName]>
              | Partial<
                    Record<
                        ColumnNames<TSchema[TTableKey]>,
                        ColumnNames<TSchema[TRelatedTableName]>
                    >
                >
      }
    | {
          many: true
          on?:
              | ColumnNames<TSchema[TRelatedTableName]>
              | Partial<
                    Record<
                        ColumnNames<TSchema[TTableKey]>,
                        ColumnNames<TSchema[TRelatedTableName]>
                    >
                >
      }
)

// Helper type to create a discriminated union of all possible RelationConfig types
export type AnyRelationConfig<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema
> = {
    [K in keyof TSchema & string]: RelationConfig<TSchema, TTableKey, K>
}[keyof TSchema & string]

// Define the include configuration for a table
export type IncludeConfig<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema
> = {
    [relationName: string]:
        | (keyof TSchema & string)
        | AnyRelationConfig<TSchema, TTableKey>
}

// Strict relation config that ensures no extra properties
type StrictRelationConfig<
    TSchema extends Record<string, AnyPgTable>,
    T
> = T extends { table: infer Table }
    ? Table extends keyof TSchema & string
        ? T extends { many: true }
            ? keyof T extends
                  | "table"
                  | "include"
                  | "where"
                  | "limit"
                  | "offset"
                  | "orderBy"
                  | "many"
                  | "on"
                ? T &
                      (T extends { where: infer W }
                          ? W extends object
                              ? { where?: StrictWhereConfig<TSchema[Table], W> }
                              : object
                          : object) &
                      (T extends { include: infer I }
                          ? I extends object
                              ? { include?: StrictIncludeConfig<TSchema, I> }
                              : object
                          : object)
                : never
            : keyof T extends
                    | "table"
                    | "include"
                    | "where"
                    | "limit"
                    | "offset"
                    | "orderBy"
                    | "many"
                    | "on"
              ? T &
                    (T extends { where: infer W }
                        ? W extends object
                            ? { where?: StrictWhereConfig<TSchema[Table], W> }
                            : object
                        : object) &
                    (T extends { include: infer I }
                        ? I extends object
                            ? { include?: StrictIncludeConfig<TSchema, I> }
                            : object
                        : object)
              : never
        : never
    : T extends string
      ? T extends keyof TSchema & string
          ? T
          : never
      : never

// Strict include config that validates all relations
export type StrictIncludeConfig<
    TSchema extends Record<string, AnyPgTable>,
    T
> = {
    [K in keyof T]: StrictRelationConfig<TSchema, T[K]>
}

// Define the query configuration structure
export type QueryConfig<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema = keyof TSchema
> = {
    include?: IncludeConfig<TSchema, TTableKey>
    where?: WhereConfig<TSchema[TTableKey]>
    limit?: number
    offset?: number
    orderBy?: OrderByConfig<TSchema[TTableKey]>
}

// Helper type that ensures no excess properties
type NoExcessProperties<T, U> = T extends U
    ? keyof T extends keyof U
        ? T
        : never
    : never

// Strict version that enforces exact QueryConfig shape
export type StrictQueryConfig<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    T
> = NoExcessProperties<T, QueryConfig<TSchema, TTableKey>> &
    (T extends { where: infer W }
        ? W extends object
            ? { where?: StrictWhereConfig<TSchema[TTableKey], W> }
            : object
        : object) &
    (T extends { include: infer I }
        ? I extends object
            ? { include?: StrictIncludeConfig<TSchema, I> }
            : object
        : object)

// Helper type to infer the result type based on the query configuration
export type InferQueryResult<
    TSchema extends Record<string, AnyPgTable>,
    TTableName extends keyof TSchema,
    TQueryConfig
> = TQueryConfig extends { include: infer TInclude }
    ? InferSelectModel<TSchema[TTableName]> &
          InferIncludes<TSchema, TTableName, TInclude>
    : InferSelectModel<TSchema[TTableName]>

// Helper type to get the actual table name from a table
type GetTableName<TTable extends AnyPgTable> = TTable["_"]["name"]

// Helper type to check if a table has a foreign key column referencing another table by name
type HasForeignKeyTo<
    TFromTable extends AnyPgTable,
    TToTableName extends string
> = {
    [K in keyof TFromTable["_"]["columns"]]: TFromTable["_"]["columns"][K] extends {
        _: {
            foreignKeys?: readonly {
                reference: () => { foreignTable: { _: { name: TToTableName } } }
            }[]
        }
    }
        ? K
        : never
}[keyof TFromTable["_"]["columns"]] extends never
    ? false
    : true

// Helper to infer the model with nested includes
type InferModel<
    TSchema extends Record<string, AnyPgTable>,
    TTableName extends keyof TSchema & string,
    TNestedInclude
> = InferSelectModel<TSchema[TTableName]> &
    InferIncludes<TSchema, TTableName, TNestedInclude>

// Helper to infer the type of a single include (either shorthand string or full config)
type InferIncludeType<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TInclude
> = TInclude extends keyof TSchema & string
    ? // Shorthand: "profiles" - try to auto-detect
      HasForeignKeyTo<
          TSchema[TTableKey],
          GetTableName<TSchema[TInclude]>
      > extends true
        ? InferSelectModel<TSchema[TInclude]> | null // Many-to-one
        : HasForeignKeyTo<
                TSchema[TInclude],
                GetTableName<TSchema[TTableKey]>
            > extends true
          ? InferSelectModel<TSchema[TInclude]>[] // One-to-many
          : InferSelectModel<TSchema[TInclude]> | null // Fallback
    : TInclude extends {
            table: infer TRelatedTable
            many: true
            include: infer TNestedInclude
        }
      ? TRelatedTable extends keyof TSchema & string
          ? InferModel<TSchema, TRelatedTable, TNestedInclude>[]
          : never
      : TInclude extends { table: infer TRelatedTable; many: true }
        ? TRelatedTable extends keyof TSchema & string
            ? InferSelectModel<TSchema[TRelatedTable]>[]
            : never
        : TInclude extends {
                table: infer TRelatedTable
                include: infer TNestedInclude
            }
          ? TRelatedTable extends keyof TSchema & string
              ? InferModel<TSchema, TRelatedTable, TNestedInclude> | null
              : never
          : TInclude extends { table: infer TRelatedTable }
            ? TRelatedTable extends keyof TSchema & string
                ? // Try to auto-detect relationship type when many is not specified
                  HasForeignKeyTo<
                      TSchema[TTableKey],
                      GetTableName<TSchema[TRelatedTable]>
                  > extends true
                    ? InferSelectModel<TSchema[TRelatedTable]> | null // Many-to-one
                    : HasForeignKeyTo<
                            TSchema[TRelatedTable],
                            GetTableName<TSchema[TTableKey]>
                        > extends true
                      ? InferSelectModel<TSchema[TRelatedTable]>[] // One-to-many
                      : InferSelectModel<TSchema[TRelatedTable]> | null // Fallback
                : never
            : never

// Helper type to infer nested includes
type InferIncludes<
    TSchema extends Record<string, AnyPgTable>,
    TTableKey extends keyof TSchema,
    TInclude
> = {
    [K in keyof TInclude]: InferIncludeType<TSchema, TTableKey, TInclude[K]>
}
