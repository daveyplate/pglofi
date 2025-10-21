import { PostgrestClient } from "@supabase/postgrest-js"
import { $lofiConfig } from "../db/lofi-config"

export const getPostgrest = (token?: string) => {
    const config = $lofiConfig.get()

    if (!config) throw new Error("config is not set")
    if (!config.dbURL) throw new Error("dbURL is not set")

    const postgrest = new PostgrestClient(config.dbURL)

    token ??= config.token

    if (token) postgrest.headers.set("Authorization", `Bearer ${token}`)

    return postgrest
}
