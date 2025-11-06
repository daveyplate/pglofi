import { useAuthenticate } from "@daveyplate/better-auth-ui"
import { createFileRoute } from "@tanstack/react-router"
import { useThrottle } from "@uidotdev/usehooks"
import { PlusIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Todo } from "@/database/schema"
import { handleAction } from "@/lib/form-helpers"
import { lofi } from "@/lib/lofi"
import TodoItem from "./todos/todo-item"
import TodoSkeleton from "./todos/todo-skeleton"

export const Route = createFileRoute("/todos")({
    ssr: true,
    component: TodosPage
})

function TodosPage() {
    const { user } = useAuthenticate()
    const [q, setQ] = useState("")
    const throttledQ = useThrottle(q, 300)

    const { data: todos, isPending } = lofi.useQuery(user && "todos", {
        include: { user: "profiles" },
        where: {
            task: { ilike: `%${throttledQ}%` }
        },
        orderBy: [{ createdAt: "desc" }]
    })

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
                {isPending ? (
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
