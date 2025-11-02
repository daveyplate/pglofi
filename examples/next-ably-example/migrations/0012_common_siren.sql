ALTER TABLE "profiles" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "updatedAt" SET DEFAULT now();