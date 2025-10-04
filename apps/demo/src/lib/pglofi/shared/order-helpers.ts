import type { AnyPgTable } from "drizzle-orm/pg-core"
import type { OrderByConfig } from "./lofi-query-types"

/**
 * Normalizes orderBy configuration to a consistent array format.
 * Handles string, object, and array inputs.
 *
 * This is a shared utility used by both usePostgrestQuery and useLocalQuery.
 */
export function normalizeOrderByConfig<TTable extends AnyPgTable>(
    orderByConfig: OrderByConfig<TTable>
): Array<{ column: string; ascending: boolean }> {
    if (Array.isArray(orderByConfig)) {
        return orderByConfig.flatMap((order) => normalizeOrderByConfig(order))
    }

    if (typeof orderByConfig === "string") {
        return [{ column: orderByConfig, ascending: true }]
    }

    // Object with column names as keys: { task: "asc", createdAt: "desc" }
    return Object.entries(orderByConfig).map(([column, direction]) => ({
        column,
        ascending: direction === "asc" || direction === undefined
    }))
}
