"use client"

import { AuthUIProvider } from "@daveyplate/better-auth-ui"
import { useInitializeDb } from "@daveyplate/pglofi"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"
import { Toaster } from "sonner"
import * as schema from "@/database/schema"
import { authClient } from "@/lib/auth-client"

export function Providers({ children }: { children: ReactNode }) {
    const router = useRouter()
    const { data: sessionData } = authClient.useSession()

    useInitializeDb({
        name: "better-auth-starter",
        schema,
        storage: "memory",
        enabled: !!sessionData,
        token: sessionData?.session.token,
        sync: false
    })

    return (
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
    )
}
