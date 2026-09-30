CREATE TABLE "fee_recalibrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"reference_month" date NOT NULL,
	"from_month" date NOT NULL,
	"remaining_total" numeric(18, 2) NOT NULL,
	"previous_remaining" numeric(18, 2) NOT NULL,
	"note" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "fee_recalibrations_remaining_chk" CHECK ("fee_recalibrations"."remaining_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_progress_indicators" (
	"work_id" uuid NOT NULL,
	"month" date NOT NULL,
	"realized_cumulative" numeric(12, 8),
	"client_replanned_cumulative" numeric(12, 8),
	"target_cumulative" numeric(12, 8),
	"source" varchar(60) NOT NULL,
	"external_ref" varchar(160),
	"received_via" "received_via" DEFAULT 'USER' NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_progress_indicators_work_id_month_pk" PRIMARY KEY("work_id","month"),
	CONSTRAINT "work_progress_indicators_non_negative_chk" CHECK (coalesce("work_progress_indicators"."realized_cumulative", 0) >= 0 AND coalesce("work_progress_indicators"."client_replanned_cumulative", 0) >= 0 AND coalesce("work_progress_indicators"."target_cumulative", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "fee_recalibrations" ADD CONSTRAINT "fee_recalibrations_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_recalibrations" ADD CONSTRAINT "fee_recalibrations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_progress_indicators" ADD CONSTRAINT "work_progress_indicators_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_progress_indicators" ADD CONSTRAINT "work_progress_indicators_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_recalibrations_work_idx" ON "fee_recalibrations" USING btree ("work_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "fee_recalibrations_one_current_uq" ON "fee_recalibrations" USING btree ("work_id") WHERE "fee_recalibrations"."is_current";