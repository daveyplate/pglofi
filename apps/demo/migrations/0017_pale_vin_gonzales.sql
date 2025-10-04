DROP TABLE "accounts" CASCADE;--> statement-breakpoint
DROP TABLE "jwkss" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-select" ON "profiles" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-insert" ON "profiles" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-update" ON "profiles" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-delete" ON "profiles" CASCADE;--> statement-breakpoint
DROP TABLE "profiles" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-select" ON "projects" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-insert" ON "projects" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-update" ON "projects" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-delete" ON "projects" CASCADE;--> statement-breakpoint
DROP TABLE "projects" CASCADE;--> statement-breakpoint
DROP TABLE "sessions" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-select" ON "todos" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-insert" ON "todos" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-update" ON "todos" CASCADE;--> statement-breakpoint
DROP POLICY "crud-authenticated-policy-delete" ON "todos" CASCADE;--> statement-breakpoint
DROP TABLE "todos" CASCADE;--> statement-breakpoint
DROP TABLE "users" CASCADE;--> statement-breakpoint
DROP TABLE "verifications" CASCADE;