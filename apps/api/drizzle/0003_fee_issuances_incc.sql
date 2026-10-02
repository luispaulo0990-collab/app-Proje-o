ALTER TYPE "public"."cell_origin" ADD VALUE 'ISSUED';--> statement-breakpoint
CREATE TABLE "fee_issuances" (
	"work_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"note" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_issuances_work_id_month_pk" PRIMARY KEY("work_id","month"),
	CONSTRAINT "fee_issuances_amount_chk" CHECK ("fee_issuances"."amount" >= 0),
	CONSTRAINT "fee_issuances_month_chk" CHECK (extract(day from "fee_issuances"."month") = 1)
);
--> statement-breakpoint
CREATE TABLE "incc_rates" (
	"month" date PRIMARY KEY NOT NULL,
	"rate" numeric(12, 8) NOT NULL,
	"note" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incc_rates_rate_chk" CHECK ("incc_rates"."rate" > -1),
	CONSTRAINT "incc_rates_month_chk" CHECK (extract(day from "incc_rates"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "fee_recalibrations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "fee_recalibrations" CASCADE;--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT "works_fee_lag_chk";--> statement-breakpoint
ALTER TABLE "fee_issuances" ADD CONSTRAINT "fee_issuances_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_issuances" ADD CONSTRAINT "fee_issuances_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incc_rates" ADD CONSTRAINT "incc_rates_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" DROP COLUMN "fee_lag_months";