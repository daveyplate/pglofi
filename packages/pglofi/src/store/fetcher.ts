import { nanoquery } from "@nanostores/query"

export const [
    createFetcherStore,
    createMutatorStore,
    { invalidateKeys, revalidateKeys, mutateCache }
] = nanoquery({
    revalidateOnFocus: true,
    revalidateOnReconnect: true
})
