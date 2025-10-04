import { useEffect, useState } from "react"

type MountInfo = {
    count: number
    resourceId: string
}

type NamespaceListener = (mountedResources: string[]) => void

class MountTracker {
    mounts = new Map<string, Map<string, MountInfo>>()
    listeners = new Map<string, Set<NamespaceListener>>()

    mount(namespace: string, resourceId: string) {
        let namespaceMap = this.mounts.get(namespace)

        if (!namespaceMap) {
            namespaceMap = new Map()
            this.mounts.set(namespace, namespaceMap)
        }

        const existing = namespaceMap.get(resourceId)

        if (existing) {
            existing.count++
        } else {
            namespaceMap.set(resourceId, { count: 1, resourceId })
        }

        this.notifyListeners(namespace)

        return () => this.unmount(namespace, resourceId)
    }

    unmount(namespace: string, resourceId: string) {
        const namespaceMap = this.mounts.get(namespace)

        if (!namespaceMap) {
            console.warn(
                `Attempted to unmount from non-existent namespace "${namespace}"`
            )
            return
        }

        const existing = namespaceMap.get(resourceId)

        if (!existing) {
            console.warn(
                `Attempted to unmount resource "${resourceId}" from namespace "${namespace}" that was not mounted`
            )
            return
        }

        existing.count--

        if (existing.count <= 0) {
            namespaceMap.delete(resourceId)
        }

        if (namespaceMap.size === 0) {
            this.mounts.delete(namespace)
        }

        this.notifyListeners(namespace)
    }

    getMounted(namespace: string) {
        const namespaceMap = this.mounts.get(namespace)
        return namespaceMap ? Array.from(namespaceMap.keys()) : []
    }

    subscribe(namespace: string, listener: NamespaceListener) {
        let namespaceListeners = this.listeners.get(namespace)

        if (!namespaceListeners) {
            namespaceListeners = new Set()
            this.listeners.set(namespace, namespaceListeners)
        }

        namespaceListeners.add(listener)

        listener(this.getMounted(namespace))

        return () => {
            namespaceListeners?.delete(listener)

            if (namespaceListeners?.size === 0) {
                this.listeners.delete(namespace)
            }
        }
    }

    notifyListeners(namespace: string) {
        const namespaceListeners = this.listeners.get(namespace)
        if (!namespaceListeners) return

        const mountedResources = this.getMounted(namespace)
        for (const listener of namespaceListeners) {
            listener(mountedResources)
        }
    }
}

export const mountTracker = new MountTracker()

export function useMounted(namespace: string) {
    const [mounted, setMounted] = useState<string[]>(() =>
        mountTracker.getMounted(namespace)
    )

    useEffect(() => {
        const unsubscribe = mountTracker.subscribe(namespace, setMounted)
        return unsubscribe
    }, [namespace])

    return mounted
}
