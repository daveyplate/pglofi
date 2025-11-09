import type { InferInsertModel } from "drizzle-orm"
import { isEqual } from "lodash-es"
import { addRxPlugin } from "rxdb/plugins/core"
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode"

import { createCollections } from "./database/create-collections"
import { createDatabase, destroyDatabase } from "./database/create-database"
import { createReplications } from "./database/create-replications"
import { type LofiConfig, receiveConfig } from "./database/lofi-config"
import { deleteEntity, insertEntity, updateEntity } from "./mutators/mutators"
import { createQuery } from "./query/create-query"
import type { QueryConfig, StrictQueryConfig } from "./query/query-types"
import { subscribeQuery } from "./query/subscribe-query"
import {
    configStore,
    dbStore,
    replicationStatesStore,
    syncStartedStore,
    tokenStore
} from "./stores"
import {
    filterTableSchema,
    type TableKey,
    type TablesOnly
} from "./utils/schema-filter"

export async function createLofi<TSchema extends Record<string, unknown>>(
    config: LofiConfig<TSchema>
) {
    const isServer = typeof window === "undefined"
    const resolvedConfig = receiveConfig(config)
    const sanitizedSchema = filterTableSchema(resolvedConfig.schema)

    if (resolvedConfig.autoStart) {
        syncStartedStore.setState(true)
    }

    // Check if something changed in the config and destroy and recreate the db
    if (!isServer && configStore.state && dbStore.state) {
        if (
            configStore.state.name !== resolvedConfig.name ||
            configStore.state.storage !== resolvedConfig.storage ||
            !isEqual(configStore.state.schema, config.schema)
        ) {
            await destroyDatabase()
        }
    }

    if (!isServer && !dbStore.state) {
        if (resolvedConfig.devMode) {
            addRxPlugin(RxDBDevModePlugin)
        }

        try {
            const db = await createDatabase(resolvedConfig)
            await createCollections(resolvedConfig, db)
            await createReplications(resolvedConfig, db)
        } catch (error) {
            if (resolvedConfig.migrationStrategy) throw error

            console.error(error)

            await destroyDatabase()
            const db = await createDatabase(resolvedConfig)

            for (const storage of db.storageInstances) {
                await storage.remove()
            }

            await createCollections(resolvedConfig, db)
            await createReplications(resolvedConfig, db)
        }
    }

    configStore.setState(resolvedConfig)

    const startSync = async () => {
        for (const tableKey in replicationStatesStore.state) {
            await replicationStatesStore.state[tableKey].start()
        }

        syncStartedStore.setState(true)
    }

    return {
        setToken: (token?: string | null) => {
            tokenStore.setState(token)

            if (token) startSync()
        },
        startSync,
        createQuery: <
            TTableKey extends TableKey<TSchema>,
            TQueryConfig extends QueryConfig<TablesOnly<TSchema>, TTableKey>
        >(
            tableKey?: TTableKey | null | 0 | false | "",
            query?: StrictQueryConfig<
                TablesOnly<TSchema>,
                TTableKey,
                TQueryConfig
            >
        ) => createQuery(sanitizedSchema, tableKey, query),
        subscribeQuery: <
            TTableKey extends TableKey<TSchema>,
            TQueryConfig extends QueryConfig<TablesOnly<TSchema>, TTableKey>
        >(
            tableKey?: TTableKey | null | 0 | false | "",
            query?: StrictQueryConfig<
                TablesOnly<TSchema>,
                TTableKey,
                TQueryConfig
            >
        ) =>
            subscribeQuery(
                sanitizedSchema,
                tableKey,
                query,
                resolvedConfig.plugins
            ),
        insert: <TTableKey extends TableKey<TSchema>>(
            tableKey: TTableKey,
            values: InferInsertModel<TablesOnly<TSchema>[TTableKey]>
        ) => insertEntity(sanitizedSchema, tableKey, values),
        update: <TTableKey extends TableKey<TSchema>>(
            tableKey: TTableKey,
            id: string,
            fields: Partial<InferInsertModel<TablesOnly<TSchema>[TTableKey]>>
        ) => updateEntity(sanitizedSchema, tableKey, id, fields),
        delete: <TTableKey extends TableKey<TSchema>>(
            tableKey: TTableKey,
            id: string
        ) => deleteEntity(sanitizedSchema, tableKey, id)
    }
}
