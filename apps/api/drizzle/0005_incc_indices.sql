DROP TABLE "incc_rates" CASCADE;--> statement-breakpoint
CREATE TABLE "incc_indices" (
	"month" date PRIMARY KEY NOT NULL,
	"index_value" numeric(14, 6) NOT NULL,
	"note" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incc_indices_value_chk" CHECK ("incc_indices"."index_value" > 0),
	CONSTRAINT "incc_indices_month_chk" CHECK (extract(day from "incc_indices"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "incc_indices" ADD CONSTRAINT "incc_indices_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;