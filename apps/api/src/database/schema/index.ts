import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  check,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Monetary values: NUMERIC(18,2). */
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
/** Fractions (0.0147 = 1,47%): NUMERIC(12,8) ≡ percentage with 6 decimals. */
const fraction = (name: string) => numeric(name, { precision: 12, scale: 8 });

export const roleEnum = pgEnum('user_role', ['ADMIN', 'EDITOR', 'VIEWER']);
export const workStatusEnum = pgEnum('work_status', ['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED']);
export const curveTypeEnum = pgEnum('curve_type', ['PHYSICAL']);
export const curveStatusEnum = pgEnum('curve_status', ['ACTIVE', 'ARCHIVED']);
export const seriesEnum = pgEnum('projection_series', ['PHYSICAL', 'FEE']);
export const originEnum = pgEnum('cell_origin', ['CURVE', 'MANUAL']);
export const curveSourceEnum = pgEnum('curve_source', ['PARAMETRIC', 'WORK_ACTUAL']);
export const receivedViaEnum = pgEnum('received_via', ['USER', 'API_KEY']);

// ─── Identity ──────────────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('VIEWER'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_user_idx').on(t.userId),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('password_reset_tokens_hash_uq').on(t.tokenHash)],
);

// ─── Catalog ───────────────────────────────────────────────────────────────
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 160 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('clients_name_uq').on(sql`lower(${t.name})`)],
);

// ─── Curves (parametric models, immutable versions) ────────────────────────
export const curves = pgTable('curves', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description').notNull().default(''),
  type: curveTypeEnum('type').notNull().default('PHYSICAL'),
  status: curveStatusEnum('status').notNull().default('ACTIVE'),
  ...timestamps,
});

export const curveVersions = pgTable(
  'curve_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curveId: uuid('curve_id')
      .notNull()
      .references(() => curves.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    periods: integer('periods').notNull(),
    notes: text('notes'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('curve_versions_curve_version_uq').on(t.curveId, t.version),
    check('curve_versions_periods_chk', sql`${t.periods} > 0`),
  ],
);

export const curvePoints = pgTable(
  'curve_points',
  {
    curveVersionId: uuid('curve_version_id')
      .notNull()
      .references(() => curveVersions.id, { onDelete: 'cascade' }),
    period: integer('period').notNull(),
    monthlyPct: fraction('monthly_pct').notNull(),
    cumulativePct: fraction('cumulative_pct').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.curveVersionId, t.period] }),
    check('curve_points_monthly_chk', sql`${t.monthlyPct} >= 0`),
    check('curve_points_cumulative_chk', sql`${t.cumulativePct} >= 0 AND ${t.cumulativePct} <= 1`),
  ],
);

// ─── Works ─────────────────────────────────────────────────────────────────
export const works = pgTable(
  'works',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 160 }).notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    units: integer('units').notNull(),
    budget: money('budget').notNull(),
    feeRate: fraction('fee_rate').notNull(),
    feeLagMonths: integer('fee_lag_months').notNull().default(0),
    constructionSystem: varchar('construction_system', { length: 120 }).notNull(),
    curveVersionId: uuid('curve_version_id')
      .notNull()
      .references(() => curveVersions.id, { onDelete: 'restrict' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    durationMonths: integer('duration_months').notNull(),
    status: workStatusEnum('status').notNull().default('ACTIVE'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('works_client_idx').on(t.clientId),
    index('works_status_idx').on(t.status),
    check('works_units_chk', sql`${t.units} > 0`),
    check('works_budget_chk', sql`${t.budget} >= 0`),
    check('works_fee_rate_chk', sql`${t.feeRate} >= 0 AND ${t.feeRate} <= 1`),
    check('works_fee_lag_chk', sql`${t.feeLagMonths} >= 0`),
    check('works_duration_chk', sql`${t.durationMonths} > 0`),
  ],
);

// ─── Work own curves (received from external systems, versioned) ───────────
/**
 * Physical curve of a started work, as reported by the planning/ERP system through the API.
 * Immutable per version: each import creates `version + 1` and becomes the current one.
 */
export const workActualCurves = pgTable(
  'work_actual_curves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Competence month of period 1 (real start may differ from the planned one). */
    startMonth: date('start_month', { mode: 'string' }).notNull(),
    periods: integer('periods').notNull(),
    /** Free identifier of the sending system (e.g. "SIENGE", "PLANEJAMENTO", "MANUAL"). */
    source: varchar('source', { length: 60 }).notNull(),
    externalRef: varchar('external_ref', { length: 160 }),
    note: text('note'),
    isCurrent: boolean('is_current').notNull().default(true),
    receivedVia: receivedViaEnum('received_via').notNull().default('USER'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('work_actual_curves_work_version_uq').on(t.workId, t.version),
    uniqueIndex('work_actual_curves_one_current_uq')
      .on(t.workId)
      .where(sql`${t.isCurrent}`),
    check('work_actual_curves_periods_chk', sql`${t.periods} > 0`),
  ],
);

export const workActualCurvePoints = pgTable(
  'work_actual_curve_points',
  {
    actualCurveId: uuid('actual_curve_id')
      .notNull()
      .references(() => workActualCurves.id, { onDelete: 'cascade' }),
    period: integer('period').notNull(),
    monthlyPct: fraction('monthly_pct').notNull(),
    cumulativePct: fraction('cumulative_pct').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actualCurveId, t.period] }),
    check('work_actual_curve_points_monthly_chk', sql`${t.monthlyPct} >= 0`),
    check(
      'work_actual_curve_points_cumulative_chk',
      sql`${t.cumulativePct} >= 0 AND ${t.cumulativePct} <= 1`,
    ),
  ],
);

// ─── Progress indicators of a work (received from the planning system) ──────
/**
 * Monthly progress figures used by the "Consolidado": realized cumulative, client replanning
 * and target. One row per work × month; each sync replaces the rows of the work.
 */
export const workProgressIndicators = pgTable(
  'work_progress_indicators',
  {
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    month: date('month', { mode: 'string' }).notNull(),
    /** "Realizado Acumulado". */
    realizedCumulative: fraction('realized_cumulative'),
    /** "Replanejado Atual Acumulado - Cliente". */
    clientReplannedCumulative: fraction('client_replanned_cumulative'),
    /** "Meta Acumulada - Atual". */
    targetCumulative: fraction('target_cumulative'),
    source: varchar('source', { length: 60 }).notNull(),
    externalRef: varchar('external_ref', { length: 160 }),
    receivedVia: receivedViaEnum('received_via').notNull().default('USER'),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.month] }),
    check(
      'work_progress_indicators_non_negative_chk',
      sql`coalesce(${t.realizedCumulative}, 0) >= 0 AND coalesce(${t.clientReplannedCumulative}, 0) >= 0 AND coalesce(${t.targetCumulative}, 0) >= 0`,
    ),
  ],
);

// ─── Fee recalibration ("Ajuste projeção de taxa", versioned) ──────────────
/**
 * The user informs the new Σ fee still to be received from `from_month` on; the engine spreads
 * it by the curve. Every change is a new row (history); only one is current per work.
 */
export const feeRecalibrations = pgTable(
  'fee_recalibrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    /** Consolidado reference month when the value was informed. */
    referenceMonth: date('reference_month', { mode: 'string' }).notNull(),
    /** First month affected (reference + 1). */
    fromMonth: date('from_month', { mode: 'string' }).notNull(),
    remainingTotal: money('remaining_total').notNull(),
    /** Σ fee from `from_month` before the recalibration (for comparison). */
    previousRemaining: money('previous_remaining').notNull(),
    note: text('note'),
    isCurrent: boolean('is_current').notNull().default(true),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
  },
  (t) => [
    index('fee_recalibrations_work_idx').on(t.workId, t.createdAt.desc()),
    uniqueIndex('fee_recalibrations_one_current_uq')
      .on(t.workId)
      .where(sql`${t.isCurrent}`),
    check('fee_recalibrations_remaining_chk', sql`${t.remainingTotal} >= 0`),
  ],
);

// ─── Projections (instances of a curve applied to a work, versioned) ───────
export const projections = pgTable(
  'projections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    curveVersionId: uuid('curve_version_id')
      .notNull()
      .references(() => curveVersions.id, { onDelete: 'restrict' }),
    /** Which curve generated this version: parametric model or the work's own curve. */
    curveSource: curveSourceEnum('curve_source').notNull().default('PARAMETRIC'),
    workActualCurveId: uuid('work_actual_curve_id').references(() => workActualCurves.id, {
      onDelete: 'no action',
    }),
    /** Snapshot of every engine input used (budget, rate, lag, dates, mode, manual count). */
    parameters: jsonb('parameters').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    /** Work parameters changed after this version while manual cells exist → user must recalc. */
    isStale: boolean('is_stale').notNull().default(false),
    note: text('note'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('projections_work_version_uq').on(t.workId, t.version),
    uniqueIndex('projections_one_current_uq')
      .on(t.workId)
      .where(sql`${t.isCurrent}`),
  ],
);

export const projectionValues = pgTable(
  'projection_values',
  {
    projectionId: uuid('projection_id')
      .notNull()
      .references(() => projections.id, { onDelete: 'cascade' }),
    series: seriesEnum('series').notNull(),
    periodIndex: integer('period_index').notNull(),
    periodMonth: date('period_month', { mode: 'string' }).notNull(),
    /** PHYSICAL: fraction with 8 decimals · FEE: R$ with 2 decimals (engine-enforced). */
    originalValue: numeric('original_value', { precision: 20, scale: 8 }).notNull(),
    currentValue: numeric('current_value', { precision: 20, scale: 8 }).notNull(),
    origin: originEnum('origin').notNull().default('CURVE'),
  },
  (t) => [
    primaryKey({ columns: [t.projectionId, t.series, t.periodIndex] }),
    index('projection_values_month_idx').on(t.periodMonth),
  ],
);

// ─── Audit ─────────────────────────────────────────────────────────────────
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 40 }).notNull(),
    entity: varchar('entity', { length: 40 }).notNull(),
    entityId: uuid('entity_id'),
    workId: uuid('work_id').references(() => works.id, { onDelete: 'set null' }),
    field: varchar('field', { length: 80 }),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    origin: varchar('origin', { length: 20 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_work_idx').on(t.workId, t.createdAt.desc()),
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
  ],
);
