import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/shape")({
    server: {
        handlers: {
            GET: async ({ request }) => {
                const url = new URL(request.url)

                // Construct the upstream URL
                const originUrl = new URL(
                    `https://electric-t0oh.onrender.com/v1/shape`
                )

                // console.log(ELECTRIC_PROTOCOL_QUERY_PARAMS)
                // Only pass through Electric protocol parameters
                url.searchParams.forEach((value, key) => {
                    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
                        originUrl.searchParams.set(key, value)
                    }
                })

                // Set the table server-side - not from client params
                originUrl.searchParams.set(
                    `table`,
                    url.searchParams.get(`table`)!
                )

                originUrl.searchParams.set(
                    "source_id",
                    process.env.ELECTRIC_SOURCE_ID!
                )
                originUrl.searchParams.set(
                    "secret",
                    process.env.ELECTRIC_SECRET!
                )
                //
                // Authentication and authorization
                //

                // const user = await loadUser(
                //     request.headers.get(`authorization`)
                // )

                // // If the user isn't set, return 401
                // if (!user) {
                //     return new Response(`user not found`, { status: 401 })
                // }

                // // Only query data the user has access to unless they're an admin.
                // if (!user.roles.includes(`admin`)) {
                //     // For type-safe WHERE clause generation, see the section below
                //     originUrl.searchParams.set(
                //         `where`,
                //         `org_id = '${user.org_id}'`
                //     )
                // }

                const response = await fetch(originUrl)

                // Fetch decompresses the body but doesn't remove the
                // content-encoding & content-length headers which would
                // break decoding in the browser.
                //
                // See https://github.com/whatwg/fetch/issues/1729
                const headers = new Headers(response.headers)
                headers.delete(`content-encoding`)
                headers.delete(`content-length`)

                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers
                })
            }
        }
    }
})
