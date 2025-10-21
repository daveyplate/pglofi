import * as Ably from "ably"
import { atom } from "nanostores"
import { invalidateKeys } from "../store/fetcher"

export const $ablyClient = atom<Ably.Realtime | null>(null)
export const $ablyChannels = atom<string[]>([])

// Track if we were previously disconnected to know when to invalidate cache
let wasDisconnected = false

/**
 * Initialize or update the Ably client.
 * Should only be called by setupAblySync.
 */
export function initializeAblyClient(ablyToken: string): void {
    const currentClient = $ablyClient.get()

    // Don't recreate if already exists
    if (currentClient) {
        // Check if client is disconnected and try to reconnect
        if (
            currentClient.connection.state === "disconnected" ||
            currentClient.connection.state === "suspended" ||
            currentClient.connection.state === "failed"
        ) {
            currentClient.connect()
        }
        return
    }

    const newClient = new Ably.Realtime({
        key: ablyToken,
        // Auto-reconnect on disconnect
        disconnectedRetryTimeout: 15000,
        suspendedRetryTimeout: 30000
    })

    // Set up connection monitoring for reliability
    newClient.connection.on("disconnected", () => {
        console.log("[pglofi] Ably disconnected, will auto-reconnect...")
        wasDisconnected = true
    })

    newClient.connection.on("suspended", () => {
        console.log("[pglofi] Ably connection suspended, will retry...")
        wasDisconnected = true
    })

    newClient.connection.on("connected", () => {
        console.log("[pglofi] Ably connected")

        // If we were previously disconnected, invalidate all cache to refetch fresh data
        if (wasDisconnected) {
            console.log(
                "[pglofi] Reconnected after disconnect, invalidating all cache..."
            )
            // Invalidate all keys by matching everything
            invalidateKeys(() => true)
            wasDisconnected = false
        }
    })

    newClient.connection.on("failed", () => {
        console.error("[pglofi] Ably connection failed")
        wasDisconnected = true
    })

    $ablyClient.set(newClient)
}

/**
 * Close the Ably client.
 */
export function closeAblyClient(): void {
    const currentClient = $ablyClient.get()
    if (currentClient) {
        currentClient.close()
        $ablyClient.set(null)
        wasDisconnected = false
    }
}

/**
 * Subscribe to Ably channels (framework-agnostic).
 * Adds channels to the global store and returns an unsubscribe function.
 */
export function subscribeAblyChannels(channels: string[]): () => void {
    // Add channels to the store
    const currentChannels = $ablyChannels.get()
    $ablyChannels.set([...currentChannels, ...channels])

    // Return unsubscribe function
    return () => {
        const current = $ablyChannels.get()
        // Remove only the channels that were added by this subscription
        const filtered = current.filter((ch, index) => {
            const channelIndex = channels.indexOf(ch)
            if (channelIndex === -1) return true
            // Remove one instance of each channel
            channels.splice(channelIndex, 1)
            return false
        })
        $ablyChannels.set(filtered)
    }
}
