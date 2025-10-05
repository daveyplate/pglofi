"use client"

import { useAuthenticate } from "@daveyplate/better-auth-ui"
import { Check, Loader2, Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { lofi } from "@/lib/lofi"

export default function TodoList() {
    const { data: sessionData } = useAuthenticate()
    const [newTask, setNewTask] = useState("")

    const { data: todos, isLoading } = lofi.useQuery(sessionData && "todos", {
        where: {
            userId: sessionData?.user.id
        }
    })

    async function createTodo(e: React.FormEvent) {
        e.preventDefault()
        if (!sessionData || !newTask.trim()) return

        lofi.insert("todos", {
            task: newTask.trim(),
            userId: sessionData.user.id
        })
    }

    async function toggleComplete(todoId: number, isComplete: boolean) {
        if (!sessionData) return

        lofi.update("todos", String(todoId), { isComplete: !isComplete })
    }

    async function deleteTodo(todoId: number) {
        if (!sessionData) return

        lofi.delete("todos", String(todoId))
    }

    return (
        <div className="container mx-auto max-w-3xl py-8">
            <div className="mb-8">
                <h1 className="mb-2 font-bold text-3xl">My Todos</h1>
                <p className="text-muted-foreground">
                    Manage your tasks efficiently
                </p>
            </div>

            <div className="mb-8 rounded-lg border bg-card p-6 shadow-sm">
                <form onSubmit={createTodo} className="flex items-center gap-2">
                    <input
                        type="text"
                        value={newTask}
                        onChange={(e) => setNewTask(e.target.value)}
                        placeholder="What needs to be done?"
                        className="flex-grow rounded-md border bg-background px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                        disabled={isLoading}
                    />
                    <Button
                        type="submit"
                        disabled={isLoading || !newTask.trim()}
                    >
                        {isLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Plus className="mr-2 h-4 w-4" />
                        )}
                        Add
                    </Button>
                </form>
            </div>

            {isLoading ? (
                <div className="py-8 text-center">
                    <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
                    <p>Loading your todos...</p>
                </div>
            ) : todos?.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                    <p>You don't have any todos yet. Add one to get started!</p>
                </div>
            ) : (
                <div className="divide-y rounded-lg border bg-card shadow-sm">
                    {todos?.map((todo) => (
                        <div
                            key={todo.id.toString()}
                            className="group flex items-center gap-3 p-4"
                        >
                            <Button
                                size="icon"
                                variant={
                                    todo.isComplete ? "default" : "outline"
                                }
                                className={`h-8 w-8 shrink-0 rounded-full ${todo.isComplete ? "bg-primary" : ""}`}
                                onClick={() =>
                                    toggleComplete(todo.id, todo.isComplete)
                                }
                            >
                                <Check
                                    className={`h-4 w-4 ${todo.isComplete ? "text-primary-foreground" : ""}`}
                                />
                            </Button>

                            <span
                                className={`flex-grow ${todo.isComplete ? "text-muted-foreground line-through" : ""}`}
                            >
                                {todo.task}
                            </span>

                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
                                onClick={() => deleteTodo(todo.id)}
                            >
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
