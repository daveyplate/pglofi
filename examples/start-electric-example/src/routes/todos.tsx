import { eq, ilike, useLiveQuery } from "@tanstack/react-db"
import { createFileRoute } from "@tanstack/react-router"
import { useStore } from "@tanstack/react-store"
import { useThrottle } from "@uidotdev/usehooks"
import { PlusIcon } from "lucide-react"
import { useState } from "react"

import { TodoItem } from "@/components/todos/todo-item"
import { TodoSkeleton } from "@/components/todos/todo-skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { collections } from "@/database/collections"
import { tokenStore } from "@/database/postgrest"
import type { Profile, Todo } from "@/database/schema"
import { authClient } from "@/lib/auth-client"
import { handleAction } from "@/lib/form-helpers"
import { lofi } from "@/lib/lofi"

export const Route = createFileRoute("/todos")({
  component: TodosPage,
  ssr: false
})

function TodosPage() {
  // const { user } = useAuthenticate()
  const { data: sessionData } = authClient.useSession()
  const user = sessionData?.user

  const [q, setQ] = useState("")
  const throttledQ = useThrottle(q, 300)

  const token = useStore(tokenStore)
  const { data: queryData, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ todos: collections.todos })
        // .where(({ todos }) => eq(todos.userId, user?.id))
        .where(({ todos }) => ilike(todos.task, `%${throttledQ}%`))
        .join({ profiles: collections.profiles }, ({ todos, profiles }) =>
          eq(todos.userId, profiles.id)
        ),
    [throttledQ]
  )

  const todos: (Todo & { user: Profile })[] = queryData
    ? queryData
        .filter((row) => row.profiles)
        .map((row) => ({
          ...row.todos,
          user: row.profiles!
        }))
    : []

  const insertTodo = (todo: Todo) => {
    lofi.insert("todos", todo)
  }

  return (
    <main className="container mx-auto flex flex-col gap-4 p-safe-or-4 md:p-safe-or-6">
      <form action={handleAction(insertTodo)} className="flex gap-3">
        <Input type="hidden" name="userId" defaultValue={user?.id} />

        <Input
          type="text"
          name="task"
          placeholder="Add a todo"
          autoComplete="off"
          disabled={!user}
          required
        />

        <Button disabled={!user}>
          <PlusIcon />
          Add
        </Button>
      </form>

      <Input
        type="text"
        name="task"
        placeholder="Search todos"
        autoComplete="off"
        disabled={!user}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="flex flex-col gap-4">
        {isLoading ? (
          [...Array(3)].map((_, index) => (
            <TodoSkeleton key={index.toString()} />
          ))
        ) : todos?.length === 0 ? (
          <p>No todos</p>
        ) : (
          todos?.map((todo) => <TodoItem key={todo.id} todo={todo} />)
        )}
      </div>
    </main>
  )
}
