import type { QueryClient } from "@tanstack/query-core"
import { syncQuery } from "./sync-query"

type PostgrestSyncPluginOptions = {
    queryClient?: QueryClient
}

export function postgrestSync({ queryClient }: PostgrestSyncPluginOptions) {
    return {
        sync: syncQuery
    }
}
