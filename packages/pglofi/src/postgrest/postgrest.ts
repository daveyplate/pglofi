import { PostgrestClient } from "@supabase/postgrest-js"

export const postgrest = new PostgrestClient(
    process.env.NEXT_PUBLIC_NEON_DATA_API_URL!
)

export const setPostgrestToken = (token?: string | null) => {
    if (token) {
        postgrest.headers.set("Authorization", `Bearer ${token}`)
    } else {
        postgrest.headers.delete("Authorization")
    }
}
