import { useLiveQuery } from "@tanstack/react-db"
import { createFileRoute } from "@tanstack/react-router"
import { todosCollection } from "@/collections/todos"

export const Route = createFileRoute("/todos")({
    ssr: false,
    component: TodosPage
})

function TodosPage() {
    const { data: todos } = useLiveQuery((q) =>
        q.from({ todo: todosCollection })
    )

    return (
        <div>
            {todos?.map((todo) => (
                <div key={todo.id}>{todo.task}</div>
            ))}
        </div>
    )
}
