import { createFileRoute } from "@tanstack/react-router"
import { lofi } from "@/lib/lofi"

export const Route = createFileRoute("/todos")({
    ssr: true,
    component: TodosPage
})

function TodosPage() {
    const { data: todos, isPending } = lofi.useQuery("todos", {
        include: { user: "profiles" }
    })

    console.log({ isPending })

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
