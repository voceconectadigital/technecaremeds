/**
 * Auditoria automatizada de consistência da SPEC.
 * Sai com código 1 se houver ERRO. WARN não quebra o build.
 * Uso: node tools/spec/audit.mjs docs/AURORA-CMMS-SPEC-v0.2.md
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const doc = readFileSync(file, 'utf8');
const lines = doc.split('\n');

const errors = [];
const warns = [];
const infos = [];
const err = (c, m) => errors.push(`[${c}] ${m}`);
const warn = (c, m) => warns.push(`[${c}] ${m}`);
const info = (m) => infos.push(m);

const uniq = (a) => [...new Set(a)];
const all = (re) => uniq([...doc.matchAll(re)].map((m) => m[1] ?? m[0]));

/* 1 — numeração de seções contígua */
const secs = [...doc.matchAll(/^## (\d{2})\. (.+)$/gm)].map((m) => ({ n: +m[1], t: m[2] }));
info(`seções: ${secs.length} (${secs[0]?.n} … ${secs[secs.length - 1]?.n})`);
for (let i = 1; i < secs.length; i++) {
  if (secs[i].n !== secs[i - 1].n + 1) err('SEC', `salto de seção: ${secs[i - 1].n} → ${secs[i].n}`);
}
const dupSec = secs.map((s) => s.n).filter((n, i, a) => a.indexOf(n) !== i);
if (dupSec.length) err('SEC', `seções duplicadas: ${dupSec.join(', ')}`);

/* 2 — referências §NN válidas */
const refs = uniq([...doc.matchAll(/§(\d{1,2})/g)].map((m) => +m[1]));
const secNums = new Set(secs.map((s) => s.n));
refs.filter((r) => !secNums.has(r)).forEach((r) => err('REF', `referência §${r} aponta para seção inexistente`));
info(`referências §NN distintas: ${refs.length}`);

/* 3 — personas */
const perBlocks = all(/^#### (PER-\d{2})/gm);
const declared = doc.match(/^(Dez|Oito|Nove|Dez|Onze) personas/m);
info(`personas declaradas: "${declared ? declared[1] : '?'}" · blocos PER-xx: ${perBlocks.length}`);
const word2num = { Oito: 8, Nove: 9, Dez: 10, Onze: 11 };
if (declared && word2num[declared[1]] !== perBlocks.length) {
  err('PER', `texto declara ${declared[1]} (${word2num[declared[1]]}) personas mas existem ${perBlocks.length} blocos`);
}
const perDup = [...doc.matchAll(/^#### (PER-\d{2})/gm)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
if (perDup.length) err('PER', `PER duplicados: ${perDup.join(', ')}`);

/* 4 — ADRs */
const adrRows = [...doc.matchAll(/^\| (ADR-\d{3}) \|/gm)].map((m) => m[1]);
const adrRefs = all(/\b(ADR-\d{3})\b/g);
info(`ADRs definidos: ${adrRows.length} · referenciados: ${adrRefs.length}`);
const adrDup = adrRows.filter((v, i, a) => a.indexOf(v) !== i);
if (adrDup.length) err('ADR', `ADR duplicado na tabela: ${adrDup.join(', ')}`);
adrRefs.filter((r) => !adrRows.includes(r)).forEach((r) => err('ADR', `${r} é referenciado mas não existe na tabela de decisões`));
const adrNums = adrRows.map((a) => +a.slice(4)).sort((a, b) => a - b);
for (let i = 1; i < adrNums.length; i++) {
  if (adrNums[i] !== adrNums[i - 1] + 1) warn('ADR', `lacuna na numeração: ADR-${String(adrNums[i - 1]).padStart(3, '0')} → ADR-${String(adrNums[i]).padStart(3, '0')}`);
}

/* 5 — Open questions */
const oqRows = [...doc.matchAll(/^\| (OQ-\d{2}) \|/gm)].map((m) => m[1]);
info(`open questions: ${oqRows.length}`);
const oqDup = oqRows.filter((v, i, a) => a.indexOf(v) !== i);
if (oqDup.length) err('OQ', `OQ duplicada: ${oqDup.join(', ')}`);
// toda OQ deve ter classe A/B/C/D declarada
const oqSection = doc.slice(doc.indexOf('## 46.'), doc.indexOf('## 47.'));
oqRows.forEach((id) => {
  const row = oqSection.split('\n').find((l) => l.startsWith(`| ${id} |`));
  if (row && !/\*\*[ABCD]\*\*/.test(row)) err('OQ', `${id} sem classe A/B/C/D declarada`);
});
// nenhuma OQ pode continuar marcada como bloqueante do MVP
if (/Bloqueia MVP\?/.test(doc)) err('OQ', 'cabeçalho antigo "Bloqueia MVP?" ainda presente');

/* 6 — Épicos */
// um bloco pode definir mais de um épico no mesmo cabeçalho (ex.: "EPIC-008 · EPIC-009 — …")
const epicBlocks = uniq(
  [...doc.matchAll(/^#### (.*EPIC-\d{3}.*)$/gm)].flatMap((m) => [...m[1].matchAll(/EPIC-\d{3}/g)].map((x) => x[0]))
);
// épicos também podem ser definidos como linha da tabela "Demais épicos"
const epicTableRows = all(/^\| \*\*(EPIC-\d{3})\*\*/gm);
const epicDefined = uniq([...epicBlocks, ...epicTableRows]);
const epicRefs = all(/\b(EPIC-\d{3})\b/g);
info(`épicos definidos: ${epicDefined.length} (blocos ${epicBlocks.length} + tabela ${epicTableRows.length}) · referenciados: ${epicRefs.length}`);
epicRefs.filter((e) => !epicDefined.includes(e)).forEach((e) => err('EPIC', `${e} é referenciado mas não está definido (sem bloco nem linha na tabela de épicos)`));
// backlog e roadmap devem apontar apenas para épicos definidos
const epicNums = new Set(epicDefined.map((e) => e.slice(5)));
[...doc.matchAll(/^\| BL-\d{3} \| (\d{3}|—) \|/gm)].forEach((m) => {
  if (m[1] !== '—' && !epicNums.has(m[1])) err('BL', `item de backlog referencia épico ${m[1]}, que não está definido`);
});

/* 7 — Backlog */
const blRows = [...doc.matchAll(/^\| (BL-\d{3}) \|/gm)].map((m) => m[1]);
info(`itens de backlog: ${blRows.length}`);
const blDup = blRows.filter((v, i, a) => a.indexOf(v) !== i);
if (blDup.length) err('BL', `item de backlog duplicado: ${blDup.join(', ')}`);
// dependências devem existir
const blSection = doc.slice(doc.indexOf('## 43.'), doc.indexOf('## 44.'));
[...blSection.matchAll(/^\| (BL-\d{3}) \|.*?\| (BL-\d{3}|—) \|/gm)].forEach((m) => {
  if (m[2] !== '—' && !blRows.includes(m[2])) err('BL', `${m[1]} depende de ${m[2]}, que não existe`);
});

/* 8 — User stories */
const usBlocks = all(/^#### (US-[A-Z]{2,3}-\d{3})/gm);
info(`user stories com bloco: ${usBlocks.length}`);
const usDup = [...doc.matchAll(/^#### (US-[A-Z]{2,3}-\d{3})/gm)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
if (usDup.length) err('US', `user story duplicada: ${usDup.join(', ')}`);
// toda US com bloco precisa de pelo menos um critério de aceite
usBlocks.forEach((id) => {
  const start = doc.indexOf(`#### ${id}`);
  const nextH = doc.indexOf('\n#### ', start + 5);
  const body = doc.slice(start, nextH === -1 ? start + 4000 : nextH);
  if (!/\bAC1\b/.test(body)) err('US', `${id} não possui critérios de aceite (AC1)`);
});

/* 9 — nomenclatura MVP unificada */
if (/CORE MVP/.test(doc)) err('NOM', 'termo antigo "CORE MVP" ainda presente');
if (/MVP\+/.test(doc)) err('NOM', 'termo antigo "MVP+" ainda presente');
if (/MVP operável/.test(doc)) err('NOM', 'termo antigo "MVP operável" ainda presente');
['CORE OPERACIONAL', 'MVP COMERCIAL'].forEach((t) => {
  if (!doc.includes(t)) err('NOM', `nomenclatura "${t}" não encontrada`);
});

/* 10 — hardening obrigatório presente */
const required = [
  ['FORCE ROW LEVEL SECURITY', 'HARD'],
  ['BYPASSRLS', 'HARD'],
  ['aurora_app', 'HARD'],
  ['aurora_owner', 'HARD'],
  ['set_config', 'HARD'],
  ['transaction-local', 'HARD'],
  ['current_organization_id', 'HARD'],
  ['uuid v7', 'HARD'],
  ['client_operation_id', 'HARD'],
  ['outbox', 'HARD'],
];
required.forEach(([t, c]) => { if (!doc.includes(t)) err(c, `conceito obrigatório ausente: "${t}"`); });

/* 11 — artefatos de conversão */
// artefato real é ****TEXTO****; `****` entre crases é citação legítima no changelog
if (/\*\*\*\*[^\s`]/.test(doc)) err('FMT', 'artefato de negrito **** presente');
if (/Lorem ipsum dolor/i.test(doc)) err('FMT', 'placeholder lorem ipsum real presente');

/* 12 — integridade das tabelas markdown */
let tbl = 0, bad = 0;
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith('| ')) continue;
  if (!/^\|[\s-|:]+\|$/.test(lines[i + 1] || '')) continue;
  tbl++;
  const split = (l) => l.split(/(?<!\\)\|/);
  const width = split(lines[i]).length;
  let j = i + 2;
  while (j < lines.length && lines[j].startsWith('|')) {
    const w = split(lines[j]).length;
    if (w !== width) { bad++; warn('TBL', `linha ${j + 1}: ${w - 2} colunas, cabeçalho tem ${width - 2}`); }
    j++;
  }
  i = j;
}
info(`tabelas: ${tbl} (linhas com largura divergente: ${bad})`);

/* 13 — blocos de código balanceados */
const fences = (doc.match(/^```/gm) || []).length;
if (fences % 2 !== 0) err('FMT', `blocos de código desbalanceados: ${fences} marcadores`);
info(`blocos de código: ${fences / 2}`);

/* saída */
console.log(`\nAUDITORIA — ${file}\n${'='.repeat(60)}`);
infos.forEach((i) => console.log('  · ' + i));
if (warns.length) { console.log(`\nWARN (${warns.length}):`); warns.slice(0, 20).forEach((w) => console.log('  ! ' + w)); if (warns.length > 20) console.log(`  … +${warns.length - 20}`); }
if (errors.length) { console.log(`\nERRO (${errors.length}):`); errors.forEach((e) => console.log('  ✗ ' + e)); }
console.log(`\n${errors.length === 0 ? '✓ CONSISTENTE' : '✗ INCONSISTENTE'} — ${errors.length} erro(s), ${warns.length} aviso(s)\n`);
process.exit(errors.length === 0 ? 0 : 1);
