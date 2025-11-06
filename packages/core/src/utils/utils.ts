/**
 * Helper to get environment variable from either Next.js or Vite.
 * Tries Next.js process.env first, then falls back to Vite's import.meta.env
 */
export function getEnvVar(key: string): string | undefined {
    // Next.js: process.env
    if (typeof process !== "undefined" && process.env) {
        const value = process.env[key]
        if (value) return value
    }

    // Vite: import.meta.env
    if (typeof import.meta !== "undefined") {
        // Type assertion for Vite's import.meta.env
        const viteEnv = (import.meta as { env?: Record<string, unknown> }).env
        if (viteEnv) {
            const value = viteEnv[key]
            if (typeof value === "string") return value
        }
    }

    return undefined
}
