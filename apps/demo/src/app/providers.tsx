"use client"

import { AuthUIProvider } from "@daveyplate/better-auth-ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"
import { Toaster } from "sonner"
import * as schema from "@/database/schema"
import { authClient } from "@/lib/auth-client"
import { useInitializeDb } from "@/lib/pglofi/rxdb/rxdb"
import { setPostgrestToken } from "../lib/pglofi/postgrest/postgrest"

export const queryClient = new QueryClient()

export function Providers({ children }: { children: ReactNode }) {
    const router = useRouter()
    const { data: sessionData } = authClient.useSession()
    setPostgrestToken(sessionData?.session.token)

    useInitializeDb({
        name: "neon-lofi-playground",
        schema,
        storage: "localstorage",
        enabled: !!sessionData
    })

    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
            >
                <AuthUIProvider
                    authClient={authClient}
                    multiSession
                    navigate={router.push}
                    replace={router.replace}
                    onSessionChange={() => {
                        // Clear router cache (protected routes)
                        router.refresh()
                    }}
                    Link={Link}
                >
                    {children}

                    <Toaster />
                </AuthUIProvider>
            </ThemeProvider>
        </QueryClientProvider>
    )
}
