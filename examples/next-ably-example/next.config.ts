import type { NextConfig } from "next"

const nextConfig: NextConfig = {
    /* config options here */
    serverExternalPackages: ["ably"],
    logging: {
        incomingRequests: {
            ignore: [/manifest\..*/]
        }
    }
}

export default nextConfig
