import { createLofi } from "@daveyplate/pglofi"
import * as schema from "@/database/schema"

export const lofi = createLofi(schema)
