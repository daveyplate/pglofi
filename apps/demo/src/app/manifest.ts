import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Neon LoFi Playground",
        short_name: "Neon LoFi Playground",
        description:
            "Neon LoFi Playground with Postgres, Drizzle, shadcn/ui and Tanstack Query",
        start_url: "/",
        display: "standalone",
        background_color: "#fff",
        theme_color: "#fff",
        icons: [
            {
                src: "/favicon.ico",
                sizes: "any",
                type: "image/x-icon"
            }
        ]
    }
}
