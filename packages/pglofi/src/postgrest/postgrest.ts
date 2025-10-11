import { PostgrestClient } from "@supabase/postgrest-js"
import { getLofiConfig } from "../rxdb/rxdb"

export const getPostgrest = () => {
    const config = getLofiConfig()

    if (!config) throw new Error("config is not set")
    if (!config.dbURL) throw new Error("dbURL is not set")

    const postgrest = new PostgrestClient(config.dbURL)

    if (config.token)
        postgrest.headers.set("Authorization", `Bearer ${config.token}`)

    return postgrest
}
