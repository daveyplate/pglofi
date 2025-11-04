import { createLofi } from "@pglofi/core"
import * as schema from "@/database/schema"

export const lofi = await createLofi({
    schema: schema,
    storage: "localstorage"
})

// ✅ Types now work correctly!
// TypeScript will properly infer and autocomplete all todos columns:
// id, userId, projectId, task, isComplete, createdAt, updatedAt

// Example 1: Basic query with type-safe selector
lofi.createQuery("todos", {
    selector: {
        isComplete: false,
        task: { $ilike: "%groceries%" }
    },
    limit: 10,
    sort: ["createdAt"]
})

// Example 3: Complex selectors with logical operators
lofi.createQuery("todos", {
    selector: {
        $or: [{ isComplete: false }, { task: { $like: "%urgent%" } }]
    }
})

// Example 4: Conditional queries with falsey values
const maybeTable = false as const
lofi.createQuery(maybeTable, { selector: {} })
