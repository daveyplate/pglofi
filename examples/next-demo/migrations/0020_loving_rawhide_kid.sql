ALTER POLICY "crud-authenticated-policy-select" ON "projects" TO authenticated USING ((select auth.user_id() = "projects"."userId"::text));--> statement-breakpoint
ALTER POLICY "crud-authenticated-policy-insert" ON "projects" TO authenticated WITH CHECK ((select auth.user_id() = "projects"."userId"::text));--> statement-breakpoint
ALTER POLICY "crud-authenticated-policy-update" ON "projects" TO authenticated USING ((select auth.user_id() = "projects"."userId"::text)) WITH CHECK ((select auth.user_id() = "projects"."userId"::text));--> statement-breakpoint
ALTER POLICY "crud-authenticated-policy-delete" ON "projects" TO authenticated USING ((select auth.user_id() = "projects"."userId"::text));--> statement-breakpoint
ALTER POLICY "crud-authenticated-policy-select" ON "todos" TO authenticated USING ((select auth.user_id() = "todos"."userId"::text));--> statement-breakpoint
ALTER POLICY "crud-authenticated-policy-insert" ON "todos" TO authenticated WITH CHECK ((select auth.user_id() = "todos"."userId"::text));--> statement-breakpoint
ALTER POLICY "crud-authenticated-policy-update" ON "todos" TO authenticated USING ((select auth.user_id() = "todos"."userId"::text)) WITH CHECK ((select auth.user_id() = "todos"."userId"::text));--> statement-breakpoint
ALTER POLICY "crud-authenticated-policy-delete" ON "todos" TO authenticated USING ((select auth.user_id() = "todos"."userId"::text));