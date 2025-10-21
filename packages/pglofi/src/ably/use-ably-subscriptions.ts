import { useEffect } from "react"
import { subscribeAblyChannels } from "./ably-client"

/**
 * Hook to subscribe to Ably channels using the nanostore-based system.
 *
 * Multiple components can use this hook with the same channels.
 * Channels are automatically de-duped at the core level.
 */
export function useAblySubscriptions(channels: string[]) {
    useEffect(() => {
        if (channels.length === 0) return

        // Add channels to the global store
        const unsubscribe = subscribeAblyChannels(channels)

        // Cleanup: remove channels from store
        return unsubscribe
    }, [channels])
}
