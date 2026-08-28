/**
 * Aurora — barreira contra segredo versionado.
 * Falha o build se encontrar padrão de credencial no que está sob controle de versão.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, 'JWT (possível service role key)'],
  [/sb[ap]_[A-Za-z0-9]{20,}/, 'chave Supabase'],
  [/postgresql:\/\/[^:\s]+:[^@\s]{6,}@(?!localhost|127\.0\.0\.1)/, 'URL de banco com senha real'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'token do GitHub'],
];

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.startsWith('docs/') && f !== 'tools/ci/check-secrets.mjs' && f !== '.env.example');

const findings = [];
for (const f of files) {
  let content;
  try {
    content = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const [re, label] of PATTERNS) {
    const m = content.match(re);
    if (m) findings.push(`${f}: ${label}`);
  }
}

if (findings.length) {
  console.error('SEGREDO VERSIONADO DETECTADO:');
  findings.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`✓ nenhum segredo detectado em ${files.length} arquivos versionados`);
