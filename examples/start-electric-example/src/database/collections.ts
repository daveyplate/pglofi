import {
  DeduplicatedLoadSubset,
  parseLoadSubsetOptions,
  parseWhereExpression
} from "@tanstack/db"
import { QueryClient, QueryObserver } from "@tanstack/query-core"
import { getTableName } from "drizzle-orm"
import * as schema from "@/database/schema"
import { createCollections } from "./create-collections"
import { getPostgrest, tokenStore } from "./postgrest"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      refetchOnReconnect: true
    }
  }
})

export const collections = createCollections({
  schema,
  config: ({ key, schema }) => ({
    id: key,
    syncMode: "on-demand",
    getKey: (todo: { id: string }) => todo.id,
    sync: {
      sync: ({ begin, commit, write, collection, markReady }) => {
        const dedupe = new DeduplicatedLoadSubset({
          loadSubset: async (options) => {
            const { subscription, where, orderBy, limit } = options

            const localState = collection.currentStateAsChanges({
              where,
              orderBy,
              limit
            })

            if (localState?.length) {
              console.log(key, "localState", "markReady")
              markReady()
            }

            queryClient.mount()

            const parsed = parseLoadSubsetOptions(options)

            const queryKey: string[] = [getTableName(schema)]

            parsed.filters.forEach((f) => {
              queryKey.push(`${f.field.join(".")}-${f.operator}-${f.value}`)
            })

            if (parsed.limit) {
              queryKey.push(`limit-${parsed.limit}`)
            }

            const observer = new QueryObserver(queryClient, {
              queryKey,
              queryFn: async () => {
                const postgrest = getPostgrest(
                  import.meta.env.VITE_NEON_DATA_API_URL,
                  tokenStore.state
                )

                const builder = postgrest.from(getTableName(schema)).select()

                parseWhereExpression(where, {
                  handlers: {
                    eq: (field: [], value) => {
                      builder.eq(field.join("."), value)
                    },
                    neq: (field: [], value) => {
                      builder.neq(field.join("."), value)
                    },
                    gt: (field: [], value) => {
                      builder.gt(field.join("."), value)
                    },
                    gte: (field: [], value) => {
                      builder.gte(field.join("."), value)
                    },
                    lt: (field: [], value) => {
                      builder.lt(field.join("."), value)
                    },
                    lte: (field: [], value) => {
                      builder.lte(field.join("."), value)
                    },
                    like: (field: [], value) => {
                      builder.like(field.join("."), value)
                    },
                    ilike: (field: [], value) => {
                      builder.ilike(field.join("."), value)
                    },
                    in: (field: [], value) => {
                      builder.in(field.join("."), value)
                    },
                    isNull: (field: []) => {
                      builder.is(field.join("."), null)
                    }
                  }
                })

                if (limit) {
                  builder.limit(limit)
                }

                const { data, error } = await builder

                if (error) {
                  throw error
                }

                begin()
                data.forEach((item) => {
                  write({
                    type: "update",
                    value: item
                  })
                })
                commit()

                // Need to loop and process deletes for anything that is present locally but missing in the remote.
                let hasMoreDeletes = true
                while (hasMoreDeletes) {
                  const localState = collection.currentStateAsChanges({
                    where,
                    orderBy,
                    limit
                  })

                  const localData =
                    localState?.map((change) => change.value) ?? []
                  const remoteIds = new Set(data.map((item) => item.id))
                  const entitiesToDelete = localData.filter(
                    (localItem) => !remoteIds.has(localItem.id)
                  )

                  if (entitiesToDelete.length === 0) {
                    hasMoreDeletes = false
                  } else {
                    begin()
                    entitiesToDelete.forEach((item) => {
                      write({
                        type: "delete",
                        value: item
                      })
                    })
                    commit()
                  }
                }

                return data
              }
            })

            const unsubscribe = observer.subscribe(({ isPending }) => {
              if (!isPending) {
                console.log(key, "observer", "markReady")
                markReady()
              }
            })

            subscription?.once("unsubscribed", () => {
              dedupe.reset()
              unsubscribe()
            })
          },
          onDeduplicate: (opts) => {
            console.log("deduplicate", opts)
            return true
          }
        })

        dedupe.reset()

        return { loadSubset: dedupe.loadSubset }
      }
    },
    onUpdate: async ({ collection, transaction }) => {
      await Promise.all(
        transaction.mutations.map(async ({ changes, original }) => {
          const postgrest = getPostgrest(
            import.meta.env.VITE_NEON_DATA_API_URL,
            tokenStore.state
          )

          const { data, error } = await postgrest
            .from(getTableName(schema))
            .update(changes)
            .eq("id", original.id)
            .select()

          if (error) throw error

          console.log({ data })
          if (data) {
            collection._state.syncedData.set(original.id, data[0])
          }
        })
      )
    }
  })
})

if (typeof window !== "undefined") {
  for (const collectionKey in collections) {
    const collection = collections[collectionKey as keyof typeof collections]
    const persistKey = `${collectionKey}-persist-collection`
    const persistCollection = localStorage.getItem(persistKey)
    if (persistCollection) {
      JSON.parse(persistCollection).forEach((document: { id: string }) => {
        // @ts-expect-error - Collections have different types
        collection._state.syncedData.set(document.id, document)
      })
    }

    collection.subscribeChanges(() => {
      console.log("persist collection", collectionKey)
      const persistCollection = JSON.stringify(collection.toArray)
      localStorage.setItem(persistKey, persistCollection)
    })
  }
}
