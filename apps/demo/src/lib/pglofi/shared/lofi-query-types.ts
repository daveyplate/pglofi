import type { InferSelectModel } from "drizzle-orm"
import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { WhereConfig } from "./lofi-where-types"

// Helper type to get column names from a table
type ColumnNames<TTable extends AnyPgTable> = keyof TTable["_"]["columns"] &
    string

type ColumnMapping<
    TCurrentTable extends AnyPgTable,
    TRelatedTable extends AnyPgTable
> =
    | ColumnNames<TCurrentTable> // Shorthand: "userId" or "id"
    | Partial<Record<ColumnNames<TCurrentTable>, ColumnNames<TRelatedTable>>>

// Order configuration - can be a column name (defaults to asc) or an object with column names as keys
export type OrderByConfig<TTable extends AnyPgTable> =
    | ColumnNames<TTable>
    | Partial<Record<ColumnNames<TTable>, "asc" | "desc">>
    | OrderByConfig<TTable>[]

type RelationConfig<
    TSchema extends Record<string, AnyPgTable>,
    TCurrentTable extends AnyPgTable,
    TRelatedTableName extends keyof TSchema & string
> = {
    table: TRelatedTableName
    many?: boolean
    on?: ColumnMapping<TCurrentTable, TSchema[TRelatedTableName]>
    include?: IncludeConfig<TSchema, TSchema[TRelatedTableName]>
    where?: WhereConfig<TSchema[TRelatedTableName]>
    limit?: number
    offset?: number
    orderBy?: OrderByConfig<TSchema[TRelatedTableName]>
}

// Helper type to create a discriminated union of all possible RelationConfig types
export type AnyRelationConfig<
    TSchema extends Record<string, AnyPgTable>,
    TCurrentTable extends AnyPgTable
> = {
    [K in keyof TSchema & string]: RelationConfig<TSchema, TCurrentTable, K>
}[keyof TSchema & string]

// Define the include configuration for a table
export type IncludeConfig<
    TSchema extends Record<string, AnyPgTable>,
    TCurrentTable extends AnyPgTable
> = {
    [relationName: string]:
        | (keyof TSchema & string)
        | AnyRelationConfig<TSchema, TCurrentTable>
}

// Define the query configuration structure
export type QueryConfig<
    TSchema extends Record<string, AnyPgTable>,
    TCurrentTable extends AnyPgTable = AnyPgTable
> = {
    include?: IncludeConfig<TSchema, TCurrentTable>
    where?: WhereConfig<TCurrentTable>
    limit?: number
    offset?: number
    orderBy?: OrderByConfig<TCurrentTable>
}

// Helper type to infer the result type based on the query configuration
export type InferQueryResult<
    TSchema extends Record<string, AnyPgTable>,
    TTableName extends keyof TSchema,
    TQuery
> = TQuery extends { include: infer TInclude }
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
    TCurrentTable extends AnyPgTable,
    TCurrentTableName extends keyof TSchema,
    TInclude
> = TInclude extends keyof TSchema & string
    ? // Shorthand: "profiles" - try to auto-detect
      HasForeignKeyTo<
          TCurrentTable,
          GetTableName<TSchema[TInclude]>
      > extends true
        ? InferSelectModel<TSchema[TInclude]> | null // Many-to-one
        : HasForeignKeyTo<
                TSchema[TInclude],
                GetTableName<TSchema[TCurrentTableName]>
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
                ? InferSelectModel<TSchema[TRelatedTable]> | null
                : never
            : never

// Helper type to infer nested includes
type InferIncludes<
    TSchema extends Record<string, AnyPgTable>,
    TCurrentTableName extends keyof TSchema,
    TInclude
> = {
    [K in keyof TInclude]: InferIncludeType<
        TSchema,
        TSchema[TCurrentTableName],
        TCurrentTableName,
        TInclude[K]
    >
}
