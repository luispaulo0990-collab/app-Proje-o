CREATE TYPE "public"."curve_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."curve_type" AS ENUM('PHYSICAL');--> statement-breakpoint
CREATE TYPE "public"."cell_origin" AS ENUM('CURVE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'EDITOR', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."projection_series" AS ENUM('PHYSICAL', 'FEE');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(40) NOT NULL,
	"entity" varchar(40) NOT NULL,
	"entity_id" uuid,
	"work_id" uuid,
	"field" varchar(80),
	"old_value" text,
	"new_value" text,
	"origin" varchar(20),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curve_points" (
	"curve_version_id" uuid NOT NULL,
	"period" integer NOT NULL,
	"monthly_pct" numeric(12, 8) NOT NULL,
	"cumulative_pct" numeric(12, 8) NOT NULL,
	CONSTRAINT "curve_points_curve_version_id_period_pk" PRIMARY KEY("curve_version_id","period"),
	CONSTRAINT "curve_points_monthly_chk" CHECK ("curve_points"."monthly_pct" >= 0),
	CONSTRAINT "curve_points_cumulative_chk" CHECK ("curve_points"."cumulative_pct" >= 0 AND "curve_points"."cumulative_pct" <= 1)
);
--> statement-breakpoint
CREATE TABLE "curve_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curve_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"periods" integer NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curve_versions_periods_chk" CHECK ("curve_versions"."periods" > 0)
);
--> statement-breakpoint
CREATE TABLE "curves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "curve_type" DEFAULT 'PHYSICAL' NOT NULL,
	"status" "curve_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_values" (
	"projection_id" uuid NOT NULL,
	"series" "projection_series" NOT NULL,
	"period_index" integer NOT NULL,
	"period_month" date NOT NULL,
	"original_value" numeric(20, 8) NOT NULL,
	"current_value" numeric(20, 8) NOT NULL,
	"origin" "cell_origin" DEFAULT 'CURVE' NOT NULL,
	CONSTRAINT "projection_values_projection_id_series_period_index_pk" PRIMARY KEY("projection_id","series","period_index")
);
--> statement-breakpoint
CREATE TABLE "projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"curve_version_id" uuid NOT NULL,
	"parameters" jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'VIEWER' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"client_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"budget" numeric(18, 2) NOT NULL,
	"fee_rate" numeric(12, 8) NOT NULL,
	"fee_lag_months" integer DEFAULT 0 NOT NULL,
	"construction_system" varchar(120) NOT NULL,
	"curve_version_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"duration_months" integer NOT NULL,
	"status" "work_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "works_units_chk" CHECK ("works"."units" > 0),
	CONSTRAINT "works_budget_chk" CHECK ("works"."budget" >= 0),
	CONSTRAINT "works_fee_rate_chk" CHECK ("works"."fee_rate" >= 0 AND "works"."fee_rate" <= 1),
	CONSTRAINT "works_fee_lag_chk" CHECK ("works"."fee_lag_months" >= 0),
	CONSTRAINT "works_duration_chk" CHECK ("works"."duration_months" > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curve_points" ADD CONSTRAINT "curve_points_curve_version_id_curve_versions_id_fk" FOREIGN KEY ("curve_version_id") REFERENCES "public"."curve_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curve_versions" ADD CONSTRAINT "curve_versions_curve_id_curves_id_fk" FOREIGN KEY ("curve_id") REFERENCES "public"."curves"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curve_versions" ADD CONSTRAINT "curve_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_values" ADD CONSTRAINT "projection_values_projection_id_projections_id_fk" FOREIGN KEY ("projection_id") REFERENCES "public"."projections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projections" ADD CONSTRAINT "projections_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projections" ADD CONSTRAINT "projections_curve_version_id_curve_versions_id_fk" FOREIGN KEY ("curve_version_id") REFERENCES "public"."curve_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projections" ADD CONSTRAINT "projections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_curve_version_id_curve_versions_id_fk" FOREIGN KEY ("curve_version_id") REFERENCES "public"."curve_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_work_idx" ON "audit_logs" USING btree ("work_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_name_uq" ON "clients" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "curve_versions_curve_version_uq" ON "curve_versions" USING btree ("curve_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "projection_values_month_idx" ON "projection_values" USING btree ("period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "projections_work_version_uq" ON "projections" USING btree ("work_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "projections_one_current_uq" ON "projections" USING btree ("work_id") WHERE "projections"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "works_client_idx" ON "works" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "works_status_idx" ON "works" USING btree ("status");