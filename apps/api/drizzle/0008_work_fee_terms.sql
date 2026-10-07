CREATE TYPE "public"."incc_periodicity" AS ENUM('MONTHLY', 'QUARTERLY', 'FOUR_MONTHLY', 'SEMIANNUAL', 'ANNUAL');--> statement-breakpoint
CREATE TABLE "work_fee_terms" (
	"work_id" uuid NOT NULL,
	"month" date NOT NULL,
	"fee_rate" numeric(12, 8) NOT NULL,
	"incc_periodicity" "incc_periodicity" NOT NULL,
	"note" text,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_fee_terms_work_id_month_pk" PRIMARY KEY("work_id","month"),
	CONSTRAINT "work_fee_terms_rate_chk" CHECK ("work_fee_terms"."fee_rate" >= 0 AND "work_fee_terms"."fee_rate" <= 1),
	CONSTRAINT "work_fee_terms_month_chk" CHECK (extract(day from "work_fee_terms"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "incc_periodicity" "incc_periodicity" DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "incc_base_month" date;--> statement-breakpoint
ALTER TABLE "work_fee_terms" ADD CONSTRAINT "work_fee_terms_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_fee_terms" ADD CONSTRAINT "work_fee_terms_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;