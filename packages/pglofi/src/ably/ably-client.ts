import * as Ably from "ably"
import { $lofiConfig } from "../rxdb/lofi-config"

let client: Ably.Realtime | null = null

export function getAbly() {
    if (!client) {
        client = new Ably.Realtime({
            key: $lofiConfig.get()?.ablyToken
        })
    }

    return client
}
