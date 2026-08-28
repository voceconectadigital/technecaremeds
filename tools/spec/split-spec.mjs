import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const BASE = process.argv[2];
const OUT = `${BASE}/export`;
const SPEC_DIR = `${OUT}/02-AURORA-CMMS-SPEC`;
mkdirSync(SPEC_DIR, { recursive: true });

const spec = readFileSync(`${BASE}/_spec.md`, 'utf8');

// separa preâmbulo e seções "## NN. Título"
const lines = spec.split('\n');
const marks = [];
lines.forEach((l, i) => {
  const m = l.match(/^## (\d{2})\. (.+)$/);
  if (m) marks.push({ i, n: parseInt(m[1], 10), title: m[2] });
});
const preamble = lines.slice(0, marks[0].i).join('\n').trim();
const sections = marks.map((mk, idx) => ({
  n: mk.n,
  title: mk.title,
  body: lines.slice(mk.i, idx + 1 < marks.length ? marks[idx + 1].i : lines.length).join('\n').trim(),
}));
console.log(`preâmbulo: ${preamble.length} chars · seções: ${sections.length} (${sections[0].n}..${sections[sections.length - 1].n})`);

const PARTS = [
  ['00-visao-e-personas', 1, 2],
  ['01-glossario-dominios-multitenant', 3, 5],
  ['02-clientes-locais-ativos-solicitacoes', 6, 8],
  ['03-ordens-de-servico-e-state-machine', 9, 10],
  ['04-sla-preventivas-agenda-checklists', 11, 14],
  ['05-estoque-orcamentos-contratos-documentos-portal-pwa', 15, 20],
  ['06-rbac-auditoria-notificacoes-automacoes', 21, 24],
  ['07-analytics-dashboard-busca-arquivos-campos-api-eventos', 25, 31],
  ['08-modelo-de-dados-e-erd', 32, 33],
  ['09-requisitos-ux-arquitetura-seguranca', 34, 37],
  ['10-roadmap-e-epicos', 38, 39],
  ['11-user-stories-criterios-edge-cases', 40, 42],
  ['12-backlog-mvp-adr-openquestions-antipatterns-diferenciais', 43, 48],
];

const idx = [];
PARTS.forEach(([name, from, to], i) => {
  const chunk = sections.filter((s) => s.n >= from && s.n <= to);
  if (!chunk.length) throw new Error(`parte vazia: ${name}`);
  const pad = (x) => String(x).padStart(2, '0');
  const header =
    `<!-- Aurora CMMS · Especificação funcional e arquitetural · rascunho v0.1\n` +
    `     Parte ${i + 1} de ${PARTS.length} — seções ${pad(from)} a ${pad(to)}\n` +
    `     Conteúdo idêntico ao artifact de origem; apenas convertido de HTML para Markdown. -->\n\n`;
  const body = (i === 0 ? preamble + '\n\n' : '') + chunk.map((c) => c.body).join('\n\n---\n\n');
  writeFileSync(`${SPEC_DIR}/${name}.md`, header + body + '\n', 'utf8');
  idx.push({ file: `${name}.md`, from, to, titles: chunk.map((c) => `${String(c.n).padStart(2, '0')}. ${c.title}`) });
  console.log(`  ${name}.md  seções ${pad(from)}-${pad(to)}  ${(header + body).length} chars`);
});

// documento único
copyFileSync(`${BASE}/_spec.md`, `${SPEC_DIR}/AURORA-CMMS-SPEC-COMPLETE.md`);
copyFileSync(`${BASE}/_audit.md`, `${OUT}/01-AUDITORIA-TECHNECARE.md`);

writeFileSync(`${BASE}/_index.json`, JSON.stringify(idx, null, 2), 'utf8');
console.log('OK');
