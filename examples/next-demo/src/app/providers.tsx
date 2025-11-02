"use client"

import { AuthUIProvider } from "@daveyplate/better-auth-ui"
import { useInitializeDb } from "@daveyplate/pglofi"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ThemeProvider } from "next-themes"
import type { ReactNode } from "react"
import { Toaster, toast } from "sonner"

import * as schema from "@/database/schema"
import { authClient } from "@/lib/auth-client"

export function Providers({ children }: { children: ReactNode }) {
    const router = useRouter()
    const { data: sessionData } = authClient.useSession()

    useInitializeDb({
        name: "neon-lofi-playground",
        schema,
        storage: "localstorage",
        enabled: !!sessionData,
        token: sessionData?.session.token,
        sync: "ably",
        version: 0,
        migrationStrategy: async (
            table,
            version,
            oldDocumentData,
            collection
        ) => {
            return oldDocumentData
        },
        onPushError({ operation, table, error }) {
            console.error(error)

            switch (operation) {
                case "delete":
                    toast.error(`Failed to delete from ${table}`)
                    break
                case "insert":
                    toast.error(`Failed to insert into ${table}`)
                    break
                case "update":
                    toast.error(`Failed to update on ${table}`)
                    break
            }
        }
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
    )
}
