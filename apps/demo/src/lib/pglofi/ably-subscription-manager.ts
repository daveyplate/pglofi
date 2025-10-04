import type * as Ably from "ably"
import type { RxDatabase } from "rxdb"
import { getAbly } from "./ably/ably-client"
import { postgrest } from "./postgrest/postgrest"
import { sendToPullStream } from "./rxdb/rxdb"

/**
 * Global Ably subscription manager with reference counting.
 *
 * Multiple components can subscribe to the same channel.
 * The channel is only truly unsubscribed when all subscribers are gone.
 *
 * Detaching is debounced to prevent race conditions during navigation.
 */
class AblySubscriptionManager {
    private subscriptions = new Map<
        string,
        {
            refCount: number
            unsubscribe: () => void
            detachTimeoutId?: NodeJS.Timeout
            isDetaching?: boolean
        }
    >()

    private readonly DETACH_DELAY_MS = 100

    /**
     * Subscribe to a set of channels.
     * Returns an unsubscribe function that decrements ref counts.
     */
    subscribe(channels: string[], db: RxDatabase): () => void {
        const subscribedChannels: string[] = []

        for (const channelName of channels) {
            const existing = this.subscriptions.get(channelName)

            if (existing) {
                // Channel already exists, increment ref count
                existing.refCount++
                subscribedChannels.push(channelName)

                // Cancel any pending detach
                if (existing.detachTimeoutId) {
                    clearTimeout(existing.detachTimeoutId)
                    existing.detachTimeoutId = undefined
                    console.log(
                        `[AblySubscriptionManager] Cancelled detach for ${channelName}, ref count: ${existing.refCount}`
                    )
                } else {
                    console.log(
                        `[AblySubscriptionManager] ${channelName} ref count: ${existing.refCount}`
                    )
                }
            } else {
                // New channel, subscribe to it
                console.log(
                    `[AblySubscriptionManager] Subscribing to: ${channelName}`
                )

                const ably = getAbly()
                const channel = ably.channels.get(channelName)

                const handleMessage = async (message: Ably.Message) => {
                    try {
                        const entityId = message.extras?.headers?.id
                        const updatedAt = message.extras?.headers?.updatedAt
                        const messageName = message.name

                        if (!entityId) {
                            console.warn(
                                `[AblySubscriptionManager] No entity ID in message for channel: ${channelName}`
                            )
                            return
                        }

                        // Parse table name from channel (format: tableName:columnName:value)
                        const tableName = channelName.split(":")[0]

                        if (!tableName || !db[tableName]) {
                            console.warn(
                                `[AblySubscriptionManager] Unknown table: ${tableName}`
                            )
                            return
                        }

                        // Handle DELETE
                        if (messageName === "delete") {
                            console.log(
                                `[AblySubscriptionManager] Delete message received for ${tableName}:${entityId}`
                            )

                            const foundDocuments = await db[tableName]
                                .find({ selector: { id: { $eq: entityId } } })
                                .exec()

                            if (foundDocuments.length === 0) {
                                console.log(
                                    `[AblySubscriptionManager] Document ${tableName}:${entityId} already deleted or not found`
                                )
                                return
                            }

                            const docData = foundDocuments[0].toJSON()
                            sendToPullStream(tableName, {
                                checkpoint: {},
                                documents: [{ ...docData, _deleted: true }]
                            })
                            console.log(
                                `[AblySubscriptionManager] Marked ${tableName}:${entityId} as deleted`
                            )
                            return
                        }

                        // Find the document for INSERT/UPDATE
                        const foundDocuments = await db[tableName]
                            .find({ selector: { id: { $eq: entityId } } })
                            .exec()

                        // Handle INSERT (document doesn't exist locally)
                        if (foundDocuments.length === 0) {
                            console.log(
                                `[AblySubscriptionManager] Insert detected for ${tableName}:${entityId}, fetching from server`
                            )

                            let messageData = message.data

                            if (!messageData) {
                                const { data, error } = await postgrest
                                    .from(tableName)
                                    .select("*")
                                    .eq("id", entityId)
                                    .maybeSingle()

                                if (error) {
                                    console.error(
                                        `[AblySubscriptionManager] Error fetching inserted data:`,
                                        error
                                    )
                                    return
                                }

                                messageData = data
                            }

                            if (messageData) {
                                sendToPullStream(tableName, {
                                    checkpoint: {},
                                    documents: [messageData]
                                })
                                console.log(
                                    `[AblySubscriptionManager] Inserted ${tableName}:${entityId}`
                                )
                            }
                            return
                        }

                        // Handle UPDATE
                        const firstDocument = foundDocuments[0]
                        const docData = firstDocument.toJSON()

                        // Check if local data is newer
                        if (
                            updatedAt &&
                            docData.updatedAt &&
                            new Date(docData.updatedAt).getTime() >
                                new Date(updatedAt).getTime()
                        ) {
                            console.log(
                                `[AblySubscriptionManager] Local data is newer for ${tableName}:${entityId}, skipping`
                            )
                            return
                        }

                        let messageData = message.data

                        // Fetch from server if no data in message
                        if (!messageData) {
                            console.log(
                                `[AblySubscriptionManager] No data in message, fetching from server for ${tableName}:${entityId}`
                            )
                            const { data, error } = await postgrest
                                .from(tableName)
                                .select("*")
                                .eq("id", entityId)
                                .maybeSingle()

                            if (error) {
                                console.error(
                                    `[AblySubscriptionManager] Error fetching data:`,
                                    error
                                )
                                return
                            }

                            messageData = data
                        }

                        // Update RxDB via pull stream
                        if (messageData) {
                            sendToPullStream(tableName, {
                                checkpoint: {},
                                documents: [{ ...docData, ...messageData }]
                            })
                            console.log(
                                `[AblySubscriptionManager] Updated ${tableName}:${entityId}`
                            )
                        }
                    } catch (error) {
                        console.error(
                            `[AblySubscriptionManager] Error processing message for channel ${channelName}:`,
                            error
                        )
                    }
                }

                channel.subscribe(handleMessage)

                this.subscriptions.set(channelName, {
                    refCount: 1,
                    unsubscribe: () => {
                        channel.unsubscribe(handleMessage)
                        channel.detach()
                    }
                })

                subscribedChannels.push(channelName)
            }
        }

        // Return unsubscribe function
        return () => {
            for (const channelName of subscribedChannels) {
                const subscription = this.subscriptions.get(channelName)
                if (!subscription) continue

                subscription.refCount--
                console.log(
                    `[AblySubscriptionManager] ${channelName} ref count: ${subscription.refCount}`
                )

                // Schedule detach after delay when ref count reaches 0
                if (subscription.refCount === 0) {
                    console.log(
                        `[AblySubscriptionManager] Scheduling detach for ${channelName} in ${this.DETACH_DELAY_MS}ms`
                    )

                    subscription.detachTimeoutId = setTimeout(() => {
                        // Double-check ref count is still 0 (might have been re-subscribed)
                        const sub = this.subscriptions.get(channelName)
                        if (sub && sub.refCount === 0) {
                            console.log(
                                `[AblySubscriptionManager] Detaching from: ${channelName}`
                            )
                            sub.isDetaching = true
                            sub.unsubscribe()
                            this.subscriptions.delete(channelName)
                        } else if (sub) {
                            console.log(
                                `[AblySubscriptionManager] Skipping detach for ${channelName}, ref count: ${sub.refCount}`
                            )
                        }
                    }, this.DETACH_DELAY_MS)
                }
            }
        }
    }

    /**
     * Get all currently subscribed channels (for debugging)
     */
    getActiveChannels(): string[] {
        return Array.from(this.subscriptions.keys())
    }
}

// Export singleton instance
export const ablySubscriptionManager = new AblySubscriptionManager()
