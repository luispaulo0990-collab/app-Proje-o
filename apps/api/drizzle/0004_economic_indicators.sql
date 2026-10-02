CREATE TABLE "work_economic_indicators" (
	"work_id" uuid NOT NULL,
	"month" date NOT NULL,
	"iec" numeric(12, 6),
	"projected_result" numeric(18, 2),
	"source" varchar(60) NOT NULL,
	"external_ref" varchar(160),
	"received_via" "received_via" DEFAULT 'USER' NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_economic_indicators_work_id_month_pk" PRIMARY KEY("work_id","month"),
	CONSTRAINT "work_economic_indicators_iec_chk" CHECK (coalesce("work_economic_indicators"."iec", 0) >= 0),
	CONSTRAINT "work_economic_indicators_month_chk" CHECK (extract(day from "work_economic_indicators"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "work_economic_indicators" ADD CONSTRAINT "work_economic_indicators_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_economic_indicators" ADD CONSTRAINT "work_economic_indicators_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;