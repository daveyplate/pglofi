/**
 * Dynamic subscription system with type-safe notifications
 */

// Store subscribers in a Map, keyed by subscription key
// Each key maps to an array of typed callbacks
// biome-ignore lint/suspicious/noExplicitAny: Need to store heterogeneous callbacks
const subscriptions = new Map<string, Set<(data: any) => void>>()

/**
 * Subscribe to a specific event with a typed callback
 * @param key - The subscription key/channel
 * @param callback - The callback function to invoke when notified
 * @returns Unsubscribe function to remove the subscription
 */
export function subscribe<T>(
    key: string,
    callback: (data: T) => void
): () => void {
    // Get or create the subscriber set for this key
    if (!subscriptions.has(key)) {
        subscriptions.set(key, new Set())
    }

    const subscribers = subscriptions.get(key)!
    // biome-ignore lint/suspicious/noExplicitAny: Type erasure for storage
    subscribers.add(callback as (data: any) => void)

    // Return unsubscribe function
    return () => {
        // biome-ignore lint/suspicious/noExplicitAny: Type erasure for storage
        subscribers.delete(callback as (data: any) => void)

        // Clean up empty sets
        if (subscribers.size === 0) {
            subscriptions.delete(key)
        }
    }
}

/**
 * Notify all subscribers for a specific key with data
 * @param key - The subscription key/channel
 * @param data - The data to pass to all subscribers
 */
export function notify<T>(key: string, data: T): void {
    const subscribers = subscriptions.get(key)

    if (subscribers) {
        // Create a copy to avoid issues if callbacks modify subscriptions
        const callbacksCopy = Array.from(subscribers)

        for (const callback of callbacksCopy) {
            try {
                callback(data)
            } catch (error) {
                console.error(
                    `Error in subscription callback for key "${key}":`,
                    error
                )
            }
        }
    }
}

/**
 * Subscribe and immediately receive the initial value
 * @param key - The subscription key/channel
 * @param callback - The callback function to invoke
 * @param initialValue - Optional initial value to immediately invoke callback with
 * @returns Unsubscribe function
 */
export function subscribeWithInitial<T>(
    key: string,
    callback: (data: T) => void,
    initialValue?: T
): () => void {
    const unsubscribe = subscribe(key, callback)

    // Immediately invoke with initial value if provided
    if (initialValue !== undefined) {
        callback(initialValue)
    }

    return unsubscribe
}

/**
 * Get the count of active subscribers for a key
 * @param key - The subscription key/channel
 * @returns Number of active subscribers
 */
export function getSubscriberCount(key: string): number {
    const subscribers = subscriptions.get(key)
    return subscribers ? subscribers.size : 0
}

/**
 * Check if there are any subscribers for a key
 * @param key - The subscription key/channel
 * @returns True if there are active subscribers
 */
export function hasSubscribers(key: string): boolean {
    return getSubscriberCount(key) > 0
}

/**
 * Clear all subscribers for a specific key
 * @param key - The subscription key/channel
 */
export function clearSubscribers(key: string): void {
    subscriptions.delete(key)
}

/**
 * Clear all subscriptions globally
 */
export function clearAllSubscribers(): void {
    subscriptions.clear()
}

/**
 * Get all active subscription keys
 * @returns Array of all keys that have active subscribers
 */
export function getActiveKeys(): string[] {
    return Array.from(subscriptions.keys())
}

/**
 * Create a typed subscription manager for a specific data type
 * This provides a more focused API when working with specific types
 */
export function createTypedSubscriptionManager<T>() {
    return {
        subscribe: (key: string, callback: (data: T) => void) =>
            subscribe<T>(key, callback),

        notify: (key: string, data: T) => notify<T>(key, data),

        subscribeWithInitial: (
            key: string,
            callback: (data: T) => void,
            initialValue?: T
        ) => subscribeWithInitial<T>(key, callback, initialValue),

        getSubscriberCount: (key: string) => getSubscriberCount(key),

        hasSubscribers: (key: string) => hasSubscribers(key),

        clearSubscribers: (key: string) => clearSubscribers(key)
    }
}

/**
 * Create a scoped subscription system with automatic cleanup
 * Useful for component-level subscriptions that should be cleaned up together
 */
export function createScopedSubscriptions() {
    const activeSubscriptions: Array<() => void> = []

    return {
        subscribe<T>(key: string, callback: (data: T) => void): void {
            const unsubscribe = subscribe<T>(key, callback)
            activeSubscriptions.push(unsubscribe)
        },

        subscribeWithInitial<T>(
            key: string,
            callback: (data: T) => void,
            initialValue?: T
        ): void {
            const unsubscribe = subscribeWithInitial<T>(
                key,
                callback,
                initialValue
            )
            activeSubscriptions.push(unsubscribe)
        },

        // Clean up all subscriptions in this scope
        cleanup(): void {
            for (const unsubscribe of activeSubscriptions) {
                unsubscribe()
            }
            activeSubscriptions.length = 0
        }
    }
}

// Example usage types for documentation
export type SubscriptionCallback<T> = (data: T) => void
export type UnsubscribeFn = () => void
