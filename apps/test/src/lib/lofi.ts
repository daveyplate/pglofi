import { createLofi, createPostgrestHooks } from "@daveyplate/pglofi"
import * as schema from "@/database/schema"

export const lofi = createLofi(schema)
export const pg = createPostgrestHooks(schema)
