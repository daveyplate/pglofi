import {
    ArrowRight,
    Code,
    Database,
    Palette,
    Server,
    Shield,
    Zap
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function Home() {
    const features = [
        {
            icon: Shield,
            title: "Better Auth",
            description:
                "Complete authentication with social logins and session management"
        },
        {
            icon: Database,
            title: "Neon Postgres + RLS",
            description: "Serverless Postgres with Row Level Security built-in"
        },
        {
            icon: Zap,
            title: "Real-time Updates",
            description:
                "Ably integration for WebSocket connections and live sync"
        },
        {
            icon: Code,
            title: "TypeScript + Drizzle",
            description: "Type-safe development with Drizzle ORM"
        },
        {
            icon: Palette,
            title: "shadcn/ui + Tailwind",
            description: "Beautiful components with dark mode support"
        },
        {
            icon: Server,
            title: "TanStack Query",
            description: "Powerful data fetching with automatic caching"
        }
    ]

    return (
        <main className="flex-1">
            {/* Hero Section */}
            <section className="container mx-auto max-w-6xl px-4 py-16 sm:py-24">
                <div className="mx-auto max-w-3xl text-center">
                    <div className="mb-6 inline-flex items-center rounded-full bg-primary/10 px-4 py-2 font-medium text-sm">
                        ✨ Full-stack Starter Kit
                    </div>
                    <h1 className="mb-6 font-bold text-4xl tracking-tight sm:text-6xl">
                        Neon Lo-Fi Playground
                    </h1>
                    <p className="mb-8 text-lg text-muted-foreground sm:text-xl">
                        A modern Next.js starter with authentication, real-time
                        features, and a Postgres database with row-level
                        security. Everything you need to build production-ready
                        applications.
                    </p>
                    <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
                        <Link href="/todos">
                            <Button size="lg" className="w-full sm:w-auto">
                                Get Started
                                <ArrowRight />
                            </Button>
                        </Link>
                    </div>
                </div>
            </section>

            {/* Features Grid */}
            <section className="border-t bg-muted/30">
                <div className="container mx-auto max-w-6xl px-4 py-16">
                    <h2 className="mb-12 text-center font-bold text-3xl">
                        Everything You Need
                    </h2>
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {features.map((feature) => (
                            <div
                                key={feature.title}
                                className="rounded-xl border bg-card p-6 transition-all hover:shadow-lg"
                            >
                                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                    <feature.icon className="h-6 w-6 text-primary" />
                                </div>
                                <h3 className="mb-2 font-semibold text-lg">
                                    {feature.title}
                                </h3>
                                <p className="text-muted-foreground text-sm">
                                    {feature.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Tech Stack List */}
            <section className="container mx-auto max-w-4xl px-4 py-16">
                <h2 className="mb-8 text-center font-bold text-2xl">
                    Modern Tech Stack
                </h2>
                <div className="mx-auto max-w-2xl space-y-3 rounded-xl border bg-card p-6">
                    <TechItem
                        name="Next.js 15"
                        description="with App Router and Server Components"
                    />
                    <TechItem
                        name="Better Auth"
                        description="complete authentication solution"
                    />
                    <TechItem
                        name="Neon Database"
                        description="serverless Postgres with branching"
                    />
                    <TechItem
                        name="Drizzle ORM"
                        description="type-safe database queries"
                    />
                    <TechItem
                        name="TanStack Query"
                        description="data synchronization"
                    />
                    <TechItem name="Ably" description="real-time messaging" />
                    <TechItem
                        name="RxDB"
                        description="offline-first database"
                    />
                    <TechItem
                        name="Tailwind CSS v4"
                        description="utility-first styling"
                    />
                </div>
            </section>
        </main>
    )
}

function TechItem({
    name,
    description
}: {
    name: string
    description: string
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground">- {description}</span>
        </div>
    )
}
