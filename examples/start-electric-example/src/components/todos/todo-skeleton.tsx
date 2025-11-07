import { Skeleton } from "@/components/ui/skeleton"

export default function TodoSkeleton() {
    return (
        <div className="flex items-center gap-2.5 rounded border bg-card p-3">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-32" />
        </div>
    )
}
