import { useLiveQuery } from "@tanstack/react-db"
import { ClientOnly, createFileRoute } from "@tanstack/react-router"
import { useEffect } from "react"
import { lofi } from "@/lib/lofi"

export const Route = createFileRoute("/todos")({
    ssr: true,
    component: TodosPageClient
})

function TodosPageClient() {
    return (
        <ClientOnly>
            <TodosPage />
        </ClientOnly>
    )
}

function TodosPage() {
    const {
        data: todos,
        isLoading,
        isReady
    } = useLiveQuery((q) => q.from({ todo: lofi.collections.todos }))

    useEffect(() => {
        const store = lofi.createQuery("todos", {
            include: { user: "profiles" }
        })

        console.log(store.state.data)
    }, [])

    if (isLoading) return <div>Loading...</div>
    if (!isReady) return <div>Not ready...</div>

    return (
        <div>
            {todos?.map((todo) => (
                <div key={todo.id}>{todo.task}</div>
            ))}
        </div>
    )
}
