CREATE TABLE "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"expiry" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"sequence_id" serial PRIMARY KEY NOT NULL,
	"mutation_id" text NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"rejected" boolean DEFAULT false NOT NULL,
	"data" jsonb,
	"headers" jsonb,
	"locked_by" text,
	"lock_expiry" timestamp,
	"processed" boolean DEFAULT false NOT NULL
);
