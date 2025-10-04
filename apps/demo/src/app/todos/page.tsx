"use client"

import { useThrottle } from "@uidotdev/usehooks"
import { PlusIcon } from "lucide-react"
import { type FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import { lofi } from "@/lib/lofi"
import { pushToPullStream } from "@/lib/pglofi/postgrest/pull-stream-helpers"
import TodoItem from "./todo-item"
import TodoSkeleton from "./todo-skeleton"

export default function TodosPage() {
    const { data: sessionData } = authClient.useSession()
    const [q, setQ] = useState("")
    const throttledQ = useThrottle(q, 300)

    const { data: todos, isLoading } = lofi.useQuery(sessionData && "todos", {
        orderBy: { createdAt: "desc" },
        include: { user: "profiles" },
        where: { task: { ilike: `%${throttledQ}%` } }
    })

    // const { data: users, isLoading } = lofi.useQuery(
    //     sessionData && "profiles",
    //     {
    //         orderBy: { createdAt: "desc" },
    //         include: {
    //             todos: {
    //                 table: "todos",
    //                 many: true,
    //                 include: { user: "profiles" },
    //                 where: { task: { ilike: `%${q}%` } }
    //             }
    //         }
    //     }
    // )

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!sessionData) return

        const form = e.currentTarget
        const formData = new FormData(form)
        const task = (formData.get("task") as string).trim()

        if (!task) return

        await lofi.insert("todos", {
            task,
            userId: sessionData.user.id
        })

        form.reset()
    }

    return (
        <main className="container mx-auto flex flex-col gap-4 p-safe-or-4 md:p-safe-or-6">
            <form onSubmit={handleSubmit} className="flex gap-3">
                <Input
                    type="text"
                    name="task"
                    placeholder="Add a todo"
                    autoComplete="off"
                    disabled={!sessionData}
                />

                <Button disabled={!sessionData}>
                    <PlusIcon />
                </Button>
            </form>

            <Button
                onClick={() => {
                    pushToPullStream("todos", [
                        {
                            id: crypto.randomUUID(),
                            task: crypto.randomUUID(),
                            userId: sessionData?.user.id,
                            isComplete: false,
                            updatedAt: new Date().toISOString(),
                            createdAt: new Date().toISOString()
                        }
                    ])
                }}
            >
                Bulk Write
            </Button>

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
