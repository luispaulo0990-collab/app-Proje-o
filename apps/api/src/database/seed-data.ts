import { canonicalizeCurve, curveFromCumulative } from '@unita/engine';
import { hashPassword } from '../modules/auth/crypto.js';
import type { Db } from './client.js';
import { regenerateWorksWithIssuances } from '../modules/fees/fees.service.js';
import { loadInccHistory } from './incc-history.js';
import { importPainelWorks } from './painel-import.js';
import { curvesRepository } from './repositories/curves.repository.js';
import { usersRepository } from './repositories/users.repository.js';

/** Standard 22-month S-curve found in "Painel de obras.xlsx" (Vila das Belezas, Mooca, Tucuruvi). */
const UNITA_22 = [
  '0.004',
  '0.012',
  '0.02',
  '0.025',
  '0.03',
  '0.03',
  '0.04',
  '0.045',
  '0.05',
  '0.07',
  '0.07',
  '0.07',
  '0.07',
  '0.075',
  '0.075',
  '0.07',
  '0.07',
  '0.07',
  '0.05',
  '0.03',
  '0.02',
  '0.004',
];

const LINEAR_12 = curveFromCumulative(
  Array.from({ length: 12 }, (_, i) => ((i + 1) / 12).toFixed(12)),
);

export interface SeedOptions {
  adminEmail?: string;
  adminPassword?: string;
  sampleWorks?: boolean;
  log?: (message: string) => void;
}

/** Idempotent seed: standard curves, optional admin and optional sample works. */
export async function seedDatabase(db: Db, options: SeedOptions = {}): Promise<void> {
  const log = options.log ?? ((m: string) => console.warn(m));
  {
    let admin = null;
    const email = options.adminEmail;
    const password = options.adminPassword;
    if (email && password) {
      admin =
        (await usersRepository.findByEmail(db, email)) ??
        (await usersRepository.create(db, {
          name: 'Administrador',
          email,
          passwordHash: await hashPassword(password),
          role: 'ADMIN',
        }));
      log(`Usuário admin: ${admin.email}`);
    }

    const existing = await curvesRepository.list(db, {});
    const byName = new Map(existing.map((r) => [r.curve.name, r.version]));

    const ensureCurve = async (
      name: string,
      description: string,
      points: ReturnType<typeof canonicalizeCurve>,
    ) => {
      const found = byName.get(name);
      if (found) return found;
      return db.transaction(async (tx) => {
        const curve = await curvesRepository.create(tx, { name, description, type: 'PHYSICAL' });
        return curvesRepository.createVersion(
          tx,
          { curveId: curve.id, version: 1, notes: 'Carga inicial', createdById: admin?.id ?? null },
          points,
        );
      });
    };

    const standard = await ensureCurve(
      'Curva Padrão Unità — 22 meses',
      'Curva S importada da planilha Painel de Obras (Vila das Belezas / Mooca / Tucuruvi).',
      canonicalizeCurve(UNITA_22.map((monthlyPct, i) => ({ period: i + 1, monthlyPct }))),
    );
    await ensureCurve(
      'Linear — 12 meses',
      'Distribuição uniforme, útil para testes e obras curtas.',
      canonicalizeCurve(LINEAR_12),
    );
    log('Curvas padrão disponíveis.');

    const incc = await loadInccHistory(db);
    if (incc > 0) {
      // New months of INCC change the corrected balance of works that already have issuances.
      const works = await regenerateWorksWithIssuances(
        db,
        { user: null, integration: 'carga:incc-di' },
        `Histórico INCC-DI carregado (${incc} meses)`,
      );
      log(`INCC-DI: ${incc} mês(es) de histórico carregado(s); ${works} obra(s) recalculada(s).`);
    }

    if (options.sampleWorks) {
      // Real portfolio from "Painel de obras.xlsx" (aba Painel (2)); replaces old fictitious samples.
      await importPainelWorks(db, standard.id, log);
    }
  }
}
