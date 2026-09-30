import { describe, expect, it } from 'vitest';
import { matchWorkNames } from '../src/integrations/work-name-matcher.js';
import { parseFisicoGeral } from '../src/integrations/microsoft-graph/fisico-geral.parser.js';

const works: { id: string; name: string; clientName: string }[] = [
  ['Benx', 'Klabin'],
  ['Habita', 'Atlântico Meridional'],
  ['Habita', 'Elza Guimarães'],
  ['Habita', 'Sacomã'],
  ['Lidera', 'Vila Suissa'],
  ['Limac', 'Tucuruvi'],
  ['Marka Prime', 'Tucuruvi'],
  ['Metrocasa', 'Artur Alvim'],
  ['Metrocasa', 'Campo Belo'],
  ['Metrocasa', 'Estação Vila Prudente'],
  ['Metrocasa', 'Cupece'],
  ['Metrocasa', 'Vila Ema'],
  ['Miraus', 'Alvorada'],
].map(([clientName, name], i) => ({
  id: `w${i}`,
  name: String(name),
  clientName: String(clientName),
}));

const sheet: { key: string; name: string; client: string | null }[] = [
  ['Viva Benx Klabin', 'Benx/Hines'],
  ['Habita Atlântico Meridional', null],
  ['Habita Elza Guimarães', null],
  ['Habita Sacomã', null],
  ['Vila Suissa Residencial', null],
  ['Serena Tucuruvi', null],
  ['Marka Tucuruvi', null],
  ['MetroCasa Artur Alvim', null],
  ['MetroCasa Campo Belo', null],
  ['MetroCasa Estação Vila Prudente', null],
  ['MetroCasa Vista Cupecê', null],
  ['Miraus Alvorada', null],
].map(([name, client], i) => ({ key: String(i), name: String(name), client: client ?? null }));

const nameOf = (id: string) => {
  const work = works.find((w) => w.id === id);
  if (!work) throw new Error(id);
  return work;
};

describe('matchWorkNames', () => {
  it('matches the 12 works of BD_Infos Gerais to the registered names', () => {
    const result = matchWorkNames(sheet, works);
    const pairs = sheet.map((s) => {
      const m = result.get(s.key);
      return m ? `${nameOf(m.workId).clientName} ${nameOf(m.workId).name}` : null;
    });
    expect(pairs).toEqual([
      'Benx Klabin',
      'Habita Atlântico Meridional',
      'Habita Elza Guimarães',
      'Habita Sacomã',
      'Lidera Vila Suissa',
      'Limac Tucuruvi', // only Tucuruvi left once "Marka Tucuruvi" took Marka Prime
      'Marka Prime Tucuruvi',
      'Metrocasa Artur Alvim',
      'Metrocasa Campo Belo',
      'Metrocasa Estação Vila Prudente',
      'Metrocasa Cupece',
      'Miraus Alvorada',
    ]);
    expect([...result.values()].every((m) => m.kind === 'APPROXIMATE')).toBe(true);
  });

  it('exact names win and ambiguity is never guessed', () => {
    const r = matchWorkNames(
      [
        { key: 'a', name: 'Vila Ema', client: null },
        { key: 'b', name: 'Tucuruvi', client: null },
      ],
      works,
    );
    expect(r.get('a')).toEqual({ workId: 'w11', kind: 'EXACT' });
    expect(r.has('b')).toBe(false); // two "Tucuruvi" and no client → unmatched
  });

  it('does not match partial words', () => {
    const r = matchWorkNames([{ key: 'a', name: 'Klabinha Towers', client: null }], works);
    expect(r.size).toBe(0);
  });
});

describe('parseFisicoGeral — empty and invalid cells', () => {
  it('skips empty cumulative silently and reports raw invalid values', () => {
    const rows = [
      ['Nome da Obra', 'Mês do Fechamento', 'Replanejado Atual  Acumulado - Obra'],
      ['Obra X', 46023, 0.5],
      ['Obra X', 46054, 1],
      ['Obra X', 46082, ''],
      ['Obra X', 46113, null],
      ['Obra X', 46143, '#N/A'],
      ['Obra X', 'xyz', 0.3],
    ];
    const { curves, issues } = parseFisicoGeral(rows);
    expect(curves[0]?.entries).toHaveLength(2);
    expect(issues.map((i) => i.message)).toEqual([
      'Obra X: acumulado inválido ("#N/A").',
      'Obra X: mês inválido ("xyz").',
    ]);
  });
});
