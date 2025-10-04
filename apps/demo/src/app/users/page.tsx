"use client"

import { authClient } from "@/lib/auth-client"
import { lofi } from "@/lib/lofi"

export default function UsersPage() {
    const { data: sessionData } = authClient.useSession()
    const { data: users, isLoading } = lofi.useQuery(sessionData && "profiles")

    return (
        <main className="container mx-auto flex flex-col gap-4 p-safe-or-4 md:p-safe-or-6">
            {isLoading && <div>Loading...</div>}
            {!isLoading && users?.length === 0 && <div>No users</div>}
            {!isLoading &&
                users?.map((user) => <div key={user.id}>{user.name}</div>)}
        </main>
    )
}
