"use client"

import { useThrottle } from "@uidotdev/usehooks"
import { PlusIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Todo } from "@/database/schema"
import { authClient } from "@/lib/auth-client"
import { handleAction } from "@/lib/form-helpers"
import { lofi } from "@/lib/lofi"
import TodoItem from "./todo-item"
import TodoSkeleton from "./todo-skeleton"

export default function TodosPage() {
    const { data: sessionData } = authClient.useSession()
    const [q, setQ] = useState("")
    const throttledQ = useThrottle(q, 300)

    const { data: todos, isLoading } = lofi.useQuery(sessionData && "todos", {
        include: { user: "profiles" },
        selector: {
            task: { $ilike: `%${throttledQ}%` },
            userId: sessionData?.user.id
        },
        sort: [{ createdAt: "desc" }]
    })

    // const { data: users } = lofi.useQuery(sessionData && "profiles", {
    //     sort: [{ createdAt: "desc" }],
    //     include: {
    //         todos: {
    //             from: "todos",
    //             many: true,
    //             include: { user: "profiles" },
    //             selector: { $and: [{ task: "heh" }] }
    //         }
    //     }
    // })

    const insertTodo = (todo: Todo) => lofi.insert("todos", todo)

    return (
        <main className="container mx-auto flex flex-col gap-4 p-safe-or-4 md:p-safe-or-6">
            <form action={handleAction(insertTodo)} className="flex gap-3">
                <Input
                    type="hidden"
                    name="userId"
                    value={sessionData?.user.id}
                />

                <Input
                    type="text"
                    name="task"
                    placeholder="Add a todo"
                    autoComplete="off"
                    disabled={!sessionData}
                    required
                />

                <Button disabled={!sessionData}>
                    <PlusIcon />
                </Button>
            </form>

            <Input
                type="text"
                name="task"
                placeholder="Search todos"
                autoComplete="off"
                disabled={!sessionData}
                value={q}
                onChange={(e) => setQ(e.target.value)}
            />

            <div className="flex flex-col gap-4">
                {isLoading &&
                    [...Array(3)].map((_, index) => (
                        <TodoSkeleton key={index} />
                    ))}

                {!isLoading && todos?.length === 0 && <p>No todos</p>}

                {!isLoading &&
                    todos?.map((todo) => (
                        <TodoItem key={todo.id} todo={todo} />
                    ))}
            </div>
        </main>
    )
}
