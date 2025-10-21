import type { RxDatabase } from "rxdb"
import { $lofiConfig } from "../db/lofi-config"
import {
    $ablyChannels,
    $ablyClient,
    closeAblyClient,
    initializeAblyClient
} from "./ably-client"
import { ablySubscriptionManager } from "./ably-subscription-manager"

// Global state to track Ably setup
let currentAblyToken: string | null = null
let isAblySetup = false
let configUnsubscribe: (() => void) | null = null

// Global state to track channel sync setup
let isSyncSetup = false
let clientUnsubscribe: (() => void) | null = null
let channelsUnsubscribe: (() => void) | null = null
let syncTimeout: NodeJS.Timeout | null = null

/**
 * Manages Ably client lifecycle based on config changes.
 * Only reconnects when token actually changes.
 */
function setupAblyClientLifecycle() {
    if (isAblySetup) return

    configUnsubscribe = $lofiConfig.subscribe((config) => {
        const newToken: string | null =
            config?.sync === "ably" && config.ablyToken
                ? config.ablyToken
                : null

        // Token changed or sync disabled/enabled
        if (newToken !== currentAblyToken) {
            // Close existing client if token changed or sync disabled
            if (currentAblyToken !== null) {
                closeAblyClient()
            }

            // Initialize new client if we have a token
            if (newToken !== null) {
                initializeAblyClient(newToken)
            }

            currentAblyToken = newToken
        }
    })

    isAblySetup = true
}

/**
 * Sets up Ably channel subscription management that watches the $ablyChannels
 * and $ablyClient stores and automatically syncs subscriptions.
 *
 * This only sets up once globally - subsequent calls are no-ops.
 * Call cleanupAblySync() when the app is truly shutting down.
 */
export function setupAblySync(db: RxDatabase): void {
    // Set up client lifecycle management (only once globally)
    setupAblyClientLifecycle()

    // Set up channel sync (only once globally)
    if (!isSyncSetup) {
        setupChannelSync(db)
        isSyncSetup = true
    }
}

// Debounce delay in milliseconds to prevent race conditions during navigation
const SYNC_DEBOUNCE_MS = 50
let currentSubscribedChannels: string[] = []

/**
 * Sets up channel synchronization that persists across initializeDb calls.
 * Watches $ablyChannels and syncs with actual Ably subscriptions.
 */
function setupChannelSync(db: RxDatabase) {
    function syncAblySubscriptions() {
        const client = $ablyClient.get()
        const channels = $ablyChannels.get()

        // Can't subscribe without client or db
        if (!client || !db) {
            return
        }

        // De-dupe channels
        const uniqueChannels = Array.from(new Set(channels))

        // Find channels to add and remove
        const toAdd = uniqueChannels.filter(
            (ch) => !currentSubscribedChannels.includes(ch)
        )
        const toRemove = currentSubscribedChannels.filter(
            (ch) => !uniqueChannels.includes(ch)
        )

        // Remove old channels
        for (const channelName of toRemove) {
            const subscription =
                ablySubscriptionManager["subscriptions"].get(channelName)
            if (subscription) {
                subscription.unsubscribe()
                ablySubscriptionManager["subscriptions"].delete(channelName)
            }
        }

        // Add new channels
        if (toAdd.length > 0) {
            ablySubscriptionManager.subscribe(toAdd, db)
        }

        currentSubscribedChannels = uniqueChannels
    }

    /**
     * Debounced version of syncAblySubscriptions to prevent race conditions
     * during navigation when channels are removed and quickly re-added.
     */
    function debouncedSync() {
        // Clear any pending sync
        if (syncTimeout) {
            clearTimeout(syncTimeout)
        }

        // Schedule a new sync after debounce delay
        syncTimeout = setTimeout(() => {
            syncAblySubscriptions()
            syncTimeout = null
        }, SYNC_DEBOUNCE_MS)
    }

    // Watch for changes to Ably client
    clientUnsubscribe = $ablyClient.subscribe(() => {
        // When client changes, clear everything and resubscribe immediately (no debounce)
        ablySubscriptionManager.clearAllSubscriptions()
        currentSubscribedChannels = []
        syncAblySubscriptions()
    })

    channelsUnsubscribe = $ablyChannels.subscribe(() => {
        // Debounce channel changes to prevent race conditions during navigation
        debouncedSync()
    })
}

/**
 * Cleanup function to be called when the app is truly shutting down.
 * This closes the Ably client and cleans up all watchers and subscriptions.
 */
export function cleanupAblySync() {
    // Clear any pending sync
    if (syncTimeout) {
        clearTimeout(syncTimeout)
        syncTimeout = null
    }

    // Cleanup config watcher
    if (configUnsubscribe) {
        configUnsubscribe()
        configUnsubscribe = null
    }

    // Cleanup channel sync watchers
    if (clientUnsubscribe) {
        clientUnsubscribe()
        clientUnsubscribe = null
    }

    if (channelsUnsubscribe) {
        channelsUnsubscribe()
        channelsUnsubscribe = null
    }

    // Clear all subscriptions and close client
    ablySubscriptionManager.clearAllSubscriptions()
    closeAblyClient()

    // Reset state
    currentAblyToken = null
    currentSubscribedChannels = []
    isAblySetup = false
    isSyncSetup = false
}
