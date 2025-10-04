import * as Ably from "ably"

let client: Ably.Realtime | null = null

export function getAbly() {
    if (!client) {
        client = new Ably.Realtime({
            key: process.env.NEXT_PUBLIC_ABLY_API_KEY
        })
    }

    return client
}
