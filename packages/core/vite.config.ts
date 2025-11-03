import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

export default defineConfig({
    plugins: [
        dts({
            insertTypesEntry: true
        })
    ],
    build: {
        lib: {
            entry: "src/index.ts",
            formats: ["es"],
            fileName: "index"
        },
        rollupOptions: {
            external: ["@tanstack/react-db"]
        }
    }
})
