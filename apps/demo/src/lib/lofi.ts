import * as schema from "@/database/schema"
import { createLofi } from "./pglofi/create-lofi"

export const lofi = createLofi(schema)
