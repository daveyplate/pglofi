import {
  DeduplicatedLoadSubset,
  parseLoadSubsetOptions,
  parseWhereExpression
} from "@tanstack/db"
import { QueryClient, QueryObserver } from "@tanstack/query-core"
import { Store } from "@tanstack/store"
import { getTableName } from "drizzle-orm"
import * as schema from "@/database/schema"
import { createCollections } from "./create-collections"
import { getPostgrest } from "./postgrest"

const queryClient = new QueryClient()
export const tokenStore = new Store<string | undefined | null>(undefined)

export const collections = createCollections({
  schema,
  config: ({ key, schema }) => ({
    id: key,
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

                if (error) throw error

                return data
              }
            })

            const unsubscribe = observer.subscribe(
              ({ data, isPending, error }) => {
                if (!isPending) markReady()
                if (isPending || error || !data) return

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

                markReady()
              }
            )

            subscription?.once("unsubscribed", () => {
              dedupe.reset()
              unsubscribe()
            })
          },
          onDeduplicate: (opts) => console.log(`Call was deduplicated:`, opts)
        })

        return { loadSubset: dedupe.loadSubset }
      }
    },
    syncMode: "on-demand"
  })
})

if (typeof window !== "undefined") {
  const persistCollection = localStorage.getItem("todos-persist-collection")
  if (persistCollection) {
    JSON.parse(persistCollection).forEach((document: schema.Todo) => {
      collections.todos._state.syncedData.set(document.id, document)
    })
  }

  collections.todos.subscribeChanges((changes) => {
    console.log({ changes })

    const persistCollection = JSON.stringify(collections.todos.toArray)
    localStorage.setItem("todos-persist-collection", persistCollection)
  })
}
