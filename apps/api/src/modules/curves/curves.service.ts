import { canonicalizeCurve, validateCurve } from '@unita/engine';
import type {
  CreateCurveBody,
  CurveDetailDto,
  CurvePointInputDto,
  CurveSummaryDto,
  CurveVersionDto,
  UpdateCurveBody,
} from '@unita/contracts';
import type { Db } from '../../database/client.js';
import { auditRepository } from '../../database/repositories/audit.repository.js';
import {
  curvesRepository,
  type CurveRow,
  type CurveVersionRow,
} from '../../database/repositories/curves.repository.js';
import type { AppDeps, AuthUser } from '../../types.js';
import { notFound } from '../../utils/errors.js';

function summary(curve: CurveRow, latest: CurveVersionRow): CurveSummaryDto {
  return {
    id: curve.id,
    name: curve.name,
    description: curve.description,
    type: curve.type,
    status: curve.status,
    latestVersion: latest.version,
    latestVersionId: latest.id,
    periods: latest.periods,
    createdAt: curve.createdAt.toISOString(),
    updatedAt: curve.updatedAt.toISOString(),
  };
}

async function versionDto(db: Db, curveId: string, version: number): Promise<CurveVersionDto> {
  const found = await curvesRepository.findVersion(db, curveId, version);
  if (!found) throw notFound('Versão da curva');
  const [points, usedByWorks] = await Promise.all([
    curvesRepository.getPoints(db, found.version.id),
    curvesRepository.countWorksUsingVersion(db, found.version.id),
  ]);
  return {
    id: found.version.id,
    version: found.version.version,
    periods: found.version.periods,
    notes: found.version.notes,
    createdAt: found.version.createdAt.toISOString(),
    createdBy: found.createdBy,
    points,
    usedByWorks,
  };
}

export function createCurvesService({ db }: AppDeps) {
  async function detail(id: string): Promise<CurveDetailDto> {
    const curve = await curvesRepository.findById(db, id);
    if (!curve) throw notFound('Curva');
    const versions = await curvesRepository.listVersions(db, id);
    const latest = versions[0];
    if (!latest) throw notFound('Versão da curva');
    return {
      ...summary(curve, latest),
      current: await versionDto(db, id, latest.version),
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        createdAt: v.createdAt.toISOString(),
        periods: v.periods,
      })),
    };
  }

  return {
    detail,

    async list(filter: { status?: CurveRow['status']; q?: string }) {
      const rows = await curvesRepository.list(db, filter);
      const items = rows.map((r) => summary(r.curve, r.version));
      return { items, page: 1, pageSize: items.length, total: items.length };
    },

    getVersion: (curveId: string, version: number) => versionDto(db, curveId, version),

    validate(points: CurvePointInputDto[]) {
      const issues = validateCurve(points);
      const valid = !issues.some((i) => i.severity === 'ERROR');
      return { valid, issues, canonical: valid ? canonicalizeCurve(points) : null };
    },

    async create(input: CreateCurveBody, user: AuthUser): Promise<CurveDetailDto> {
      const points = canonicalizeCurve(input.points); // throws EngineValidationError → 422
      const id = await db.transaction(async (tx) => {
        const curve = await curvesRepository.create(tx, {
          name: input.name,
          description: input.description,
          type: input.type,
        });
        const version = await curvesRepository.createVersion(
          tx,
          { curveId: curve.id, version: 1, notes: input.notes ?? null, createdById: user.id },
          points,
        );
        await auditRepository.insert(tx, {
          userId: user.id,
          action: 'CREATE',
          entity: 'curve',
          entityId: curve.id,
          newValue: `${curve.name} V1`,
          metadata: { versionId: version.id, periods: points.length },
        });
        return curve.id;
      });
      return detail(id);
    },

    /**
     * Metadata edits update the curve row. Point edits NEVER touch an existing version:
     * a new version N+1 is appended (rule 5 — no retroactive change for works using it).
     */
    async update(id: string, input: UpdateCurveBody, user: AuthUser): Promise<CurveDetailDto> {
      const points = input.points ? canonicalizeCurve(input.points) : undefined;
      await db.transaction(async (tx) => {
        const curve = await curvesRepository.findById(tx, id);
        if (!curve) throw notFound('Curva');
        const meta = { name: input.name, description: input.description, status: input.status };
        const changes = Object.entries(meta).filter(
          ([k, v]) => v !== undefined && v !== curve[k as keyof typeof meta],
        );
        if (changes.length > 0) {
          await curvesRepository.update(tx, id, Object.fromEntries(changes));
          await auditRepository.insert(
            tx,
            changes.map(([field, value]) => ({
              userId: user.id,
              action: 'UPDATE',
              entity: 'curve',
              entityId: id,
              field,
              oldValue: String(curve[field as keyof typeof meta]),
              newValue: String(value),
            })),
          );
        }
        if (points) {
          const [latest] = await curvesRepository.listVersions(tx, id);
          const version = (latest?.version ?? 0) + 1;
          const created = await curvesRepository.createVersion(
            tx,
            { curveId: id, version, notes: input.notes ?? null, createdById: user.id },
            points,
          );
          await curvesRepository.touch(tx, id);
          await auditRepository.insert(tx, {
            userId: user.id,
            action: 'NEW_VERSION',
            entity: 'curve',
            entityId: id,
            oldValue: latest ? `V${latest.version}` : null,
            newValue: `V${version}`,
            metadata: { versionId: created.id, periods: points.length },
          });
        }
      });
      return detail(id);
    },
  };
}
