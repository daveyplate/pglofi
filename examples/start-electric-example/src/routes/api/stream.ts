import { createFileRoute } from "@tanstack/react-router"
import { realtime } from "@/lib/realtime"

export const Route = createFileRoute("/api/stream")({
  server: {
    handlers: {
      GET: ({ request: req }) => {
        const { searchParams } = new URL(req.url)
        const channels = searchParams.get("channels")

        if (!channels) {
          return new Response("Channels required", { status: 400 })
        }

        const channelsArray = channels.split(",")
        const channel = realtime.channel(channelsArray[0])

        let pingTimeout: NodeJS.Timeout | null = null

        const stream = new ReadableStream({
          async start(controller) {
            const schedulePing = () => {
              pingTimeout = setTimeout(() => {
                const pingData = {
                  type: "ping",
                  timestamp: Date.now()
                }
                controller.enqueue(`data: ${JSON.stringify(pingData)}\n\n`)
                schedulePing() // Restart timeout on itself
              }, 10000)
            }

            // Start ping timeout immediately
            schedulePing()

            await channel.on("db.change", (data) => {
              const streamData = {
                data,
                __event_path: ["db", "change"],
                __stream_id: Date.now(),
                __channel: channelsArray[0]
              }

              controller.enqueue(`data: ${JSON.stringify(streamData)}\n\n`)

              // Restart ping timeout whenever we receive data
              if (pingTimeout) {
                clearTimeout(pingTimeout)
              }
              schedulePing()
            })
          },
          cancel() {
            // Clean up timeout when stream is cancelled
            if (pingTimeout) {
              clearTimeout(pingTimeout)
              pingTimeout = null
            }
          }
        })

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          }
        })
      }
    }
  }
})
