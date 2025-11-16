import {
  type Collection,
  type CollectionConfig,
  createCollection
} from "@tanstack/db"
import type { InferSelectModel } from "drizzle-orm"
import { type AnyPgTable, PgTable } from "drizzle-orm/pg-core"
import { ZodObject, type z } from "zod"

type ValidCollectionValue = z.ZodObject<z.ZodRawShape> | AnyPgTable

type InferCollectionType<T> = T extends z.ZodObject<z.ZodRawShape>
  ? z.infer<T>
  : T extends AnyPgTable
    ? InferSelectModel<T>
    : never

type ValidKeys<TSchema extends Record<string, unknown>> = {
  [K in keyof TSchema]: TSchema[K] extends ValidCollectionValue ? K : never
}[keyof TSchema]

type SchemaForKey<
  TSchema extends Record<string, unknown>,
  K extends ValidKeys<TSchema>
> = Extract<TSchema[K], AnyPgTable> extends never
  ? Extract<TSchema[K], z.ZodObject<z.ZodRawShape>>
  : Extract<TSchema[K], AnyPgTable>

type CreateCollectionsOptions<TSchema extends Record<string, unknown>> = {
  schema: TSchema
  config: <K extends ValidKeys<TSchema>>({
    key,
    schema
  }: {
    key: K
    schema: SchemaForKey<TSchema, K>
    // biome-ignore lint/suspicious/noExplicitAny: CollectionConfig accepts any for flexibility
  }) => CollectionConfig<any, any, never, any>
}

type CreateCollectionsReturn<TSchema extends Record<string, unknown>> = {
  [K in keyof TSchema as TSchema[K] extends ValidCollectionValue
    ? K
    : never]: Collection<InferCollectionType<TSchema[K]>>
}

export function createCollections<TSchema extends Record<string, unknown>>({
  schema,
  config
}: CreateCollectionsOptions<TSchema>): CreateCollectionsReturn<TSchema> {
  const collections = {} as Record<string, Collection>

  for (const key in schema) {
    if (
      !(schema[key] instanceof PgTable) &&
      !(schema[key] instanceof ZodObject)
    )
      continue

    const validKey = key as unknown as ValidKeys<TSchema>
    const collection = createCollection(
      config({
        key: validKey,
        schema: schema[validKey] as SchemaForKey<TSchema, ValidKeys<TSchema>>
      })
    )

    collections[key] = collection
  }

  return collections as unknown as CreateCollectionsReturn<TSchema>
}
