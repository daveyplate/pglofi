import { electricCollectionOptions } from "@tanstack/electric-db-collection"
import { createCollection } from "@tanstack/react-db"
import type { Todo } from "@/database/schema"

export const todosCollection = createCollection(
    electricCollectionOptions({
        shapeOptions: {
            url: "http://localhost:3000/api/todos"
        },
        getKey: (item: Todo) => item.id
    })
)
