import { Shape, ShapeStream } from "@electric-sql/client"
import { createCollection } from "@tanstack/react-db"
import { rxdbCollectionOptions } from "@tanstack/rxdb-db-collection"
import {
    addRxPlugin,
    createRxDatabase,
    type RxReplicationPullStreamItem
} from "rxdb/plugins/core"
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode"
import { replicateRxCollection } from "rxdb/plugins/replication"
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage"
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv"
import { Subject } from "rxjs"

import { type LofiConfig, receiveConfig } from "./db/lofi-config"

let token: string | undefined

export async function createLofi<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
) {
    if (typeof window === "undefined") return {}

    const resolvedConfig = receiveConfig(config)

    if (resolvedConfig.devMode) {
        addRxPlugin(RxDBDevModePlugin)
    }

    const db = await createRxDatabase({
        name: resolvedConfig.name ?? "todos",
        closeDuplicates: true,
        storage: wrappedValidateAjvStorage({
            storage: getRxStorageLocalstorage()
        })
    })

    // TODO only clear these if there's an error
    db.storageInstances.forEach((storage) => {
        storage.remove()
    })

    await db.addCollections({
        todos: {
            schema: {
                title: "todos",
                version: 0,
                type: "object",
                primaryKey: "id",
                properties: {
                    id: { type: "string", maxLength: 100 },
                    task: { type: "string" },
                    isComplete: { type: "boolean" }
                },
                required: ["id", "task", "isComplete"]
            }
        }
    })

    const pullStream$ = new Subject<
        RxReplicationPullStreamItem<unknown, unknown>
    >()

    const replicationState = replicateRxCollection({
        replicationIdentifier: "todos",
        collection: db.todos,
        autoStart: resolvedConfig.autoStart ?? true,
        pull: {
            handler: async () => {
                return { checkpoint: {}, documents: [] }
            },
            stream$: pullStream$.asObservable()
        },
        push: {
            handler: async () => {
                console.log("pushing todos")
                return []
            }
        }
    })

    const stream = new ShapeStream({
        url: resolvedConfig.shapeURL!,
        params: {
            table: "todos"
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
    })

    const shape = new Shape(stream)
    shape.subscribe((data) => {
        pullStream$.next({
            checkpoint: {},
            documents: data.rows.map((row) => ({
                id: row.id,
                task: row.task,
                isComplete: row.isComplete,
                _deleted: false
            }))
        })
    })

    const todosCollection = createCollection(
        rxdbCollectionOptions({
            rxCollection: db.todos,
            startSync: true
        })
    )

    return {
        todosCollection,
        setToken: (_token: string) => {
            token = _token
        }
    }
}
