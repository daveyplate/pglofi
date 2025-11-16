import { DeduplicatedLoadSubset, parseLoadSubsetOptions } from "@tanstack/db"
import { QueryClient, QueryObserver } from "@tanstack/query-core"
import { getTableName } from "drizzle-orm"
import * as schema from "@/database/schema"
import { createCollections } from "./create-collections"

const queryClient = new QueryClient()

export const collections = createCollections({
  schema,
  config: ({ key, schema }) => ({
    id: key,
    getKey: (todo: { id: string }) => todo.id,
    sync: {
      sync: ({ begin, commit, write, collection, markReady }) => {
        const dedupe = new DeduplicatedLoadSubset({
          loadSubset: async (options) => {
            const { subscription } = options
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
                console.log("queryFn")
                return [{ id: "1234" }, { id: "1235" }]
              }
            })

            const unsubscribe = observer.subscribe(({ data }) => {
              if (!data) return

              begin()
              data.forEach((item) => {
                write({
                  type: "update",
                  value: item
                })
              })
              commit()

              markReady()
            })

            // const afterCommitChanges = collection.currentStateAsChanges(
            //     {
            //         where,
            //         orderBy,
            //         limit
            //     }
            // )

            // const afterCommitData =
            //     afterCommitChanges?.map((change) => change.value) ?? []

            // console.log({ afterCommitData })

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
