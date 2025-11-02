import { type InferSelectModel, sql } from "drizzle-orm"
import { authenticatedRole, crudPolicy } from "drizzle-orm/neon"
import {
    type AnyPgColumn,
    boolean,
    jsonb,
    pgPolicy,
    pgTable,
    serial,
    text,
    timestamp,
    uuid
} from "drizzle-orm/pg-core"

import * as authSchema from "@/../auth-schema"

// Enable RLS on all auth tables and re-export them
export const users = authSchema.users.enableRLS()
export const sessions = authSchema.sessions.enableRLS()
export const accounts = authSchema.accounts.enableRLS()
export const verifications = authSchema.verifications.enableRLS()
export const jwkss = authSchema.jwkss.enableRLS()

const authUuid = (userIdColumn: AnyPgColumn) =>
    sql`(select auth.user_id()::uuid = ${userIdColumn})`

export const usersSelectPolicy = pgPolicy("crud-authenticated-policy-select", {
    for: "select",
    to: authenticatedRole,
    using: authUuid(authSchema.users.id)
}).link(authSchema.users)

export const profiles = pgTable(
    "profiles",
    {
        id: uuid()
            .primaryKey()
            .references(() => users.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        image: text("image"),
        createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp({ withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull()
    },
    () => [
        crudPolicy({
            role: authenticatedRole,
            read: true,
            modify: false
        })
    ]
)

export type Profile = InferSelectModel<typeof profiles>

export const projects = pgTable(
    "projects",
    {
        id: uuid().primaryKey().default(sql`uuid_generate_v7()`),
        name: text().notNull(),
        userId: uuid()
            .notNull()
            .references(() => profiles.id, { onDelete: "cascade" }),
        createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp({ withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull()
    },
    (table) => [
        crudPolicy({
            role: authenticatedRole,
            read: authUuid(table.userId),
            modify: authUuid(table.userId)
        })
    ]
)

export type Project = InferSelectModel<typeof projects>

export const todos = pgTable(
    "todos",
    {
        id: uuid().primaryKey().default(sql`uuid_generate_v7()`),
        userId: uuid()
            .notNull()
            .references(() => profiles.id, { onDelete: "cascade" }),
        projectId: uuid().references(() => projects.id),
        task: text().notNull().default(""),
        isComplete: boolean().notNull().default(false),
        createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp({ withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull()
    },
    (table) => [
        crudPolicy({
            role: authenticatedRole,
            read: authUuid(table.userId),
            modify: authUuid(table.userId)
        })
    ]
)

export type Todo = InferSelectModel<typeof todos>

export const chats = pgTable(
    "chats",
    {
        id: uuid().primaryKey().default(sql`uuid_generate_v7()`),
        createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp({ withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull()
    },
    () => [
        crudPolicy({
            role: authenticatedRole,
            read: true,
            modify: false
        })
    ]
)

export type Chat = InferSelectModel<typeof chats>

export const messages = pgTable(
    "messages",
    {
        id: uuid().primaryKey().default(sql`uuid_generate_v7()`),
        userId: uuid()
            .notNull()
            .references(() => profiles.id, { onDelete: "cascade" }),
        chatId: uuid().references(() => chats.id, { onDelete: "cascade" }),
        content: text().notNull(),
        createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp({ withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull()
    },
    (table) => [
        crudPolicy({
            role: authenticatedRole,
            read: true,
            modify: authUuid(table.userId)
        })
    ]
)

export type Message = InferSelectModel<typeof messages>

export const nodes = pgTable("nodes", {
    id: text().primaryKey(),
    expiry: timestamp({ withTimezone: false }).notNull()
}).enableRLS()

export const outbox = pgTable("outbox", {
    sequenceId: serial("sequence_id").primaryKey(),
    mutationId: text("mutation_id").notNull(),
    channel: text().notNull(),
    name: text().notNull(),
    rejected: boolean().notNull().default(false),
    data: jsonb(),
    headers: jsonb(),
    lockedBy: text("locked_by"),
    lockExpiry: timestamp("lock_expiry", { withTimezone: false }),
    processed: boolean().notNull().default(false)
}).enableRLS()
