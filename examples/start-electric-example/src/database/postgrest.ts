import { PostgrestClient } from "@supabase/postgrest-js"
import { Store } from "@tanstack/store"

export const tokenStore = new Store<string | undefined | null>(undefined)

export function getPostgrest(dbURL?: string, token?: string | null) {
  if (!dbURL) {
    throw new Error("dbURL is not set")
  }

  const postgrest = new PostgrestClient(dbURL)

  if (token) {
    postgrest.headers.set("Authorization", `Bearer ${token}`)
  }

  return postgrest
}
