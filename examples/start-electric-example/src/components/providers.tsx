import { AuthUIProvider } from "@daveyplate/better-auth-ui"
import { tokenStore } from "@pglofi/core"
import { Link, useRouter } from "@tanstack/react-router"
import { ThemeProvider } from "next-themes"
import { useEffect } from "react"

import { authClient } from "@/lib/auth-client"
import { MetaTheme } from "./meta-theme"

export function Providers({ children }: { children: React.ReactNode }) {
    const { navigate } = useRouter()
    const { data: sessionData, isPending: sessionPending } =
        authClient.useSession()

    useEffect(() => {
        if (sessionPending) return

        tokenStore.setState(sessionData?.session.token)
    }, [sessionData, sessionPending])

    return (
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
        >
            <AuthUIProvider
                authClient={authClient}
                navigate={(href) => navigate({ href })}
                replace={(href) => navigate({ href, replace: true })}
                Link={({ href, ...props }) => <Link to={href} {...props} />}
            >
                {children}

                <MetaTheme />
            </AuthUIProvider>
        </ThemeProvider>
    )
}
