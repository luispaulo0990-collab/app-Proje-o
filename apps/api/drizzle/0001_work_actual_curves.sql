CREATE TYPE "public"."curve_source" AS ENUM('PARAMETRIC', 'WORK_ACTUAL');--> statement-breakpoint
CREATE TYPE "public"."received_via" AS ENUM('USER', 'API_KEY');--> statement-breakpoint
CREATE TABLE "work_actual_curve_points" (
	"actual_curve_id" uuid NOT NULL,
	"period" integer NOT NULL,
	"monthly_pct" numeric(12, 8) NOT NULL,
	"cumulative_pct" numeric(12, 8) NOT NULL,
	CONSTRAINT "work_actual_curve_points_actual_curve_id_period_pk" PRIMARY KEY("actual_curve_id","period"),
	CONSTRAINT "work_actual_curve_points_monthly_chk" CHECK ("work_actual_curve_points"."monthly_pct" >= 0),
	CONSTRAINT "work_actual_curve_points_cumulative_chk" CHECK ("work_actual_curve_points"."cumulative_pct" >= 0 AND "work_actual_curve_points"."cumulative_pct" <= 1)
);
--> statement-breakpoint
CREATE TABLE "work_actual_curves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"start_month" date NOT NULL,
	"periods" integer NOT NULL,
	"source" varchar(60) NOT NULL,
	"external_ref" varchar(160),
	"note" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"received_via" "received_via" DEFAULT 'USER' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_actual_curves_periods_chk" CHECK ("work_actual_curves"."periods" > 0)
);
--> statement-breakpoint
ALTER TABLE "projections" ADD COLUMN "curve_source" "curve_source" DEFAULT 'PARAMETRIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "projections" ADD COLUMN "work_actual_curve_id" uuid;--> statement-breakpoint
ALTER TABLE "work_actual_curve_points" ADD CONSTRAINT "work_actual_curve_points_actual_curve_id_work_actual_curves_id_fk" FOREIGN KEY ("actual_curve_id") REFERENCES "public"."work_actual_curves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_actual_curves" ADD CONSTRAINT "work_actual_curves_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_actual_curves" ADD CONSTRAINT "work_actual_curves_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_actual_curves_work_version_uq" ON "work_actual_curves" USING btree ("work_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "work_actual_curves_one_current_uq" ON "work_actual_curves" USING btree ("work_id") WHERE "work_actual_curves"."is_current";--> statement-breakpoint
ALTER TABLE "projections" ADD CONSTRAINT "projections_work_actual_curve_id_work_actual_curves_id_fk" FOREIGN KEY ("work_actual_curve_id") REFERENCES "public"."work_actual_curves"("id") ON DELETE no action ON UPDATE no action;