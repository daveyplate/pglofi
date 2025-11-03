import { useLiveQuery } from "@tanstack/react-db"
import { ClientOnly, createFileRoute } from "@tanstack/react-router"
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
    } = useLiveQuery((q) => {
        if (!lofi.todosCollection) return null

        console.log("lofi.todosCollection", lofi.todosCollection)

        const query = q.from({ todo: lofi.todosCollection })
        // console.log("query", query)
        return query
    })

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
