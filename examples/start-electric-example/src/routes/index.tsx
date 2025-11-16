import { useLiveQuery } from "@tanstack/react-db"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect } from "react"
import { collections } from "@/database/collections"

export const Route = createFileRoute("/")({ component: IndexPage, ssr: false })

function IndexPage() {
  const queryEnabled = true
  const { data: todos } = useLiveQuery(
    (q) =>
      queryEnabled &&
      q
        .from({ todos: collections.todos })
        .orderBy(({ todos }) => todos.id, "asc")
        .limit(100)
  )

  console.log({ todos })

  useEffect(() => {}, [])

  return (
    <main className="container mx-auto flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Hello, world.</h1>
    </main>
  )
}
