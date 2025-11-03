import { useLiveQuery } from "@tanstack/react-db"
import { createFileRoute } from "@tanstack/react-router"
import { todosCollection } from "@/collections/rxdb"

export const Route = createFileRoute("/todos")({
    ssr: false,
    component: TodosPage
})

function TodosPage() {
    const {
        data: todos,
        isLoading,
        isReady
    } = useLiveQuery((q) => {
        const query = q.from({ todo: todosCollection })
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
