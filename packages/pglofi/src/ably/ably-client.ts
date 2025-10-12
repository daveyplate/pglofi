import * as Ably from "ably"
import { getLofiConfig } from "../rxdb/rxdb"

let client: Ably.Realtime | null = null

export function getAbly() {
    if (!client) {
        client = new Ably.Realtime({
            key: getLofiConfig()?.ablyToken
        })
    }

    return client
}
