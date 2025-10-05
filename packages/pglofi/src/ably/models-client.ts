import ModelsClient from "@ably-labs/models"
import { Realtime } from "ably"

let client: ModelsClient

export const modelsClient = () => {
    if (client) return client
    const ably = new Realtime({ key: process.env.NEXT_PUBLIC_ABLY_API_KEY })

    client = new ModelsClient({ ably })
    return client
}
