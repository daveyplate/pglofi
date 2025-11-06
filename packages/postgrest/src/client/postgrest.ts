import { PostgrestClient } from "@supabase/postgrest-js"

export function getPostgrest(dbURL?: string, token?: string) {
    if (!dbURL) {
        throw new Error("dbURL is not set")
    }

    const postgrest = new PostgrestClient(dbURL)

    if (token) {
        postgrest.headers.set("Authorization", `Bearer ${token}`)
    }

    return postgrest
}
