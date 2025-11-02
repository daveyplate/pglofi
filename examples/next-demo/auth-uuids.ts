#!/usr/bin/env ts-node

import * as fs from "node:fs"
import * as path from "node:path"

const AUTH_SCHEMA_PATH = path.join(__dirname, "auth-schema.ts")

function migrateIdsToUuid() {
    console.log("Reading auth-schema.ts...")
    let content = fs.readFileSync(AUTH_SCHEMA_PATH, "utf-8")

    // Step 1: Update imports to include uuid
    console.log("Updating imports...")
    const importRegex =
        /import\s*{\s*([^}]+)\s*}\s*from\s*["']drizzle-orm\/pg-core["'];?/
    const importMatch = content.match(importRegex)

    if (importMatch) {
        const imports = importMatch[1].split(",").map((i) => i.trim())
        if (!imports.includes("uuid")) {
            imports.push("uuid")
            const newImport = `import { ${imports.join(", ")} } from "drizzle-orm/pg-core";`
            content = content.replace(importRegex, newImport)
            console.log("✓ Added uuid to imports")
        }
    }

    // Step 2: Replace all id-related fields from text to uuid
    // This automatically detects any field ending with "Id" or just "id"
    // Only converts fields that are either:
    // 1. Primary keys (id: text("id").primaryKey())
    // 2. Foreign keys (userId: text("userId")...references(...))
    // Skips provider-specific IDs that don't have .references()

    // Find all text("...Id") or text("id") patterns with their context
    const idFieldRegex = /(\w+):\s*text\("([a-zA-Z]*[Ii]d)"\)((?:[^,}])*)/g
    const matches = [...content.matchAll(idFieldRegex)]

    let totalReplacements = 0
    const replacedFields: string[] = []
    const skippedFields: string[] = []

    for (const match of matches) {
        const fieldName = match[2] // The ID field name (e.g., "id", "userId")
        const afterPattern = match[3] // Everything after text("...")

        // Check if this is a primary key or foreign key
        const isPrimaryKey = afterPattern.includes(".primaryKey()")
        const isForeignKey = afterPattern.includes(".references(")

        // Only convert if it's a primary key or foreign key
        if (isPrimaryKey || isForeignKey) {
            // Replace this specific occurrence
            const oldPattern = `text("${fieldName}")`
            const newPattern = `uuid("${fieldName}")`

            content = content.replace(
                new RegExp(
                    oldPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                    "g"
                ),
                newPattern
            )
            replacedFields.push(fieldName)
            totalReplacements++
        } else {
            // Skip non-FK, non-PK ID fields (like accountId, providerId)
            skippedFields.push(fieldName)
        }
    }

    // Report what was replaced
    if (replacedFields.length > 0) {
        const uniqueFields = [...new Set(replacedFields)]
        console.log(`✓ Replaced ${totalReplacements} ID fields:`)
        for (const field of uniqueFields) {
            const count = replacedFields.filter((f) => f === field).length
            console.log(
                `  - ${field} (${count} occurrence${count > 1 ? "s" : ""})`
            )
        }
    }

    // Report what was skipped
    if (skippedFields.length > 0) {
        const uniqueSkipped = [...new Set(skippedFields)]
        console.log(
            `\n⊘ Skipped ${uniqueSkipped.length} non-FK ID field(s) (keeping as text):`
        )
        for (const field of uniqueSkipped) {
            console.log(`  - ${field}`)
        }
    }

    // Step 3: Write the updated content back to the file
    if (totalReplacements > 0) {
        fs.writeFileSync(AUTH_SCHEMA_PATH, content, "utf-8")
        console.log(
            `\n✅ Successfully updated auth-schema.ts with ${totalReplacements} changes`
        )
        console.log(
            "⚠️  Note: You may need to create a new database migration for these changes"
        )
    } else {
        console.log(
            "\n⚠️  No changes were needed - all IDs may already be using uuid type"
        )
    }
}

// Run the migration
try {
    migrateIdsToUuid()
} catch (error) {
    console.error("❌ Error during migration:", error)
    process.exit(1)
}
