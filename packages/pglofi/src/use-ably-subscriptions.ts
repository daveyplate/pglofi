import { useEffect } from "react"
import { ablySubscriptionManager } from "./ably-subscription-manager"
import { useDb } from "./rxdb/rxdb"

/**
 * Hook to subscribe to Ably channels with automatic reference counting.
 *
 * Multiple components can use this hook with the same channels.
 * Channels are only unsubscribed when no components need them anymore.
 */
export function useAblySubscriptions(channels: string[]) {
    const db = useDb()

    useEffect(() => {
        if (!db || channels.length === 0) return

        // Subscribe via the global manager (handles ref counting)
        const unsubscribe = ablySubscriptionManager.subscribe(channels, db)

        // Cleanup: decrements ref counts
        return unsubscribe
    }, [db, channels])
}
