import { clone } from "rxdb"

const RESERVED_RXDB_FIELDS = ["_rev", "_deleted", "_attachments", "_meta"]

export function stripRxdbFields(obj: Record<string, unknown>) {
    const out = clone(obj)

    for (const k of Object.keys(out)) {
        if (RESERVED_RXDB_FIELDS.includes(k)) {
            delete out[k]
        }
    }

    return out
}
