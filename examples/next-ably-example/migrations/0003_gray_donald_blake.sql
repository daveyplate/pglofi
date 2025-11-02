ALTER TABLE "todos" ALTER COLUMN "task" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "deleted" boolean DEFAULT false NOT NULL;