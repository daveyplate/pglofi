"use client"

import { AuthUIProvider } from "@daveyplate/better-auth-ui"
import { setPostgrestToken, useInitializeDb } from "@daveyplate/pglofi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"
import { Toaster } from "sonner"
import * as schema from "@/database/schema"
import { authClient } from "@/lib/auth-client"

export const queryClient = new QueryClient()

export function Providers({ children }: { children: ReactNode }) {
    const router = useRouter()
    const { data: sessionData } = authClient.useSession()
    setPostgrestToken(sessionData?.session.token)

    useInitializeDb({
        name: "better-auth-starter",
        schema,
        storage: "memory",
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
