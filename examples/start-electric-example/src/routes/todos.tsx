import { createFileRoute } from "@tanstack/react-router"
import { useStore } from "@tanstack/react-store"
import { useEffect } from "react"
import { lofi } from "@/lib/lofi"

export const Route = createFileRoute("/todos")({
    ssr: true,
    component: TodosPage
})

function TodosPage() {
    const { data: todos, isPending } = useStore(
        lofi.createQuery("todos", { include: { user: "profiles" } })
    )

    console.log({ isPending })

    useEffect(() => {
        const unsubscribe = lofi.subscribeQuery("todos", {
            include: { user: "profiles" }
        })
        return () => unsubscribe()
    }, [])

    if (isPending) return <div>Loading...</div>

    return (
        <div>
            {todos?.map((todo) => (
                <div key={todo.id}>
                    {todo.task} - {todo.user?.name}
                </div>
            ))}
        </div>
    )
}
