import { createFileRoute } from "@tanstack/react-router"

import { handle } from "@upstash/realtime"
import { realtime } from "@/lib/realtime"

export const Route = createFileRoute("/api/realtime")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const result = await handle({ realtime })(request)
        return result as Response
      }
    }
  }
})
