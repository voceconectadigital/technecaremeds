/**
 * Aurora — ativos (SPEC v0.2 §07, ADR-006 · EPIC-005).
 *
 * `asset` é o conceito universal; "Equipamento" é apenas o rótulo pt-BR da
 * vertical clínica. Não existe entidade `equipment` — `organization.asset_label`
 * define o termo exibido, e toda a interface o usa.
 */

export const ASSET_STATUSES = [
  'active',
  'under_maintenance',
  'standby',
  'loaned',
  'decommissioned',
  'disposed',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_OWNERSHIPS = ['owned', 'leased', 'loaned', 'rented', 'service_only'] as const;
export type AssetOwnership = (typeof ASSET_OWNERSHIPS)[number];

export const ASSET_UNIQUE_FIELDS = ['tag', 'serial_number', 'asset_number'] as const;
export type AssetUniqueField = (typeof ASSET_UNIQUE_FIELDS)[number];

/**
 * Situações que contam para disponibilidade (SPEC §07).
 *
 * Só `active` e `under_maintenance`. Um ativo em `standby` não está indisponível
 * — está de reserva; contá-lo como parado afundaria o indicador de quem mantém
 * equipamento sobressalente, que é exatamente a boa prática que se quer premiar.
 */
export const AVAILABILITY_STATUSES: readonly AssetStatus[] = ['active', 'under_maintenance'];

export function countsForAvailability(status: AssetStatus): boolean {
  return AVAILABILITY_STATUSES.includes(status);
}

/** Situações terminais: o ativo saiu do inventário operacional. */
export function isRetired(status: AssetStatus): boolean {
  return status === 'decommissioned' || status === 'disposed';
}

/**
 * Token do QR Code.
 *
 * Opaco e não sequencial (SPEC §07). Sequencial permitiria varrer o inventário
 * de um cliente incrementando o número na URL — a rota `/q/{token}` é pública
 * por desenho, então o token é a única coisa entre um estranho e a ficha.
 *
 * 26 caracteres de um alfabeto de 32 dão 130 bits. O alfabeto exclui `I`, `L`,
 * `O`, `U` e `0`, `1`: a etiqueta vai ser lida por pessoa quando o leitor
 * falhar, e `0`/`O` numa etiqueta suja custa uma ligação para o suporte.
 */
const TOKEN_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const TOKEN_LENGTH = 26;

export function generateQrToken(random: (n: number) => Uint8Array): string {
  const bytes = random(TOKEN_LENGTH);
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  }
  return out;
}

export function isQrToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === TOKEN_LENGTH &&
    [...value].every((c) => TOKEN_ALPHABET.includes(c))
  );
}

/**
 * Specs efetivas de um ativo: as do modelo, sobrescritas campo a campo pelas do
 * próprio ativo (SPEC §07).
 *
 * Sobrescrita é por chave, não por objeto inteiro. Substituir o objeto faria um
 * ativo que declara só a tensão perder todas as demais specs herdadas do
 * modelo — e o desaparecimento seria silencioso.
 */
export function effectiveSpecs(
  modelSpecs: Readonly<Record<string, unknown>> | null | undefined,
  assetSpecs: Readonly<Record<string, unknown>> | null | undefined
): Record<string, unknown> {
  return { ...(modelSpecs ?? {}), ...(assetSpecs ?? {}) };
}

/** Quais specs o ativo sobrescreveu, para a ficha poder marcá-las. */
export function overriddenSpecKeys(
  modelSpecs: Readonly<Record<string, unknown>> | null | undefined,
  assetSpecs: Readonly<Record<string, unknown>> | null | undefined
): string[] {
  const model = modelSpecs ?? {};
  return Object.keys(assetSpecs ?? {}).filter(
    (k) => k in model && JSON.stringify(model[k]) !== JSON.stringify((assetSpecs ?? {})[k])
  );
}

/**
 * Idade do ativo em anos completos, a partir da data mais confiável disponível.
 *
 * Preferimos `installed_at`, depois `acquired_at`, depois `manufactured_at`.
 * Devolve `null` quando nenhuma existe, em vez de zero: zero significaria
 * "novo", e um ativo sem data não é novo, é desconhecido. A diferença importa
 * no relatório de renovação de parque.
 */
export function assetAgeYears(
  dates: { installedAt?: string | null; acquiredAt?: string | null; manufacturedAt?: string | null },
  now: Date
): number | null {
  const base = dates.installedAt ?? dates.acquiredAt ?? dates.manufacturedAt;
  if (!base) return null;
  const start = new Date(base);
  if (Number.isNaN(start.getTime())) return null;
  const anos = (now.getTime() - start.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  return anos < 0 ? 0 : Math.floor(anos);
}

/**
 * Data ISO válida de verdade.
 *
 * `Date.parse('2025-02-30')` devolve um número perfeitamente válido — o
 * JavaScript rola a data para 2 de março em silêncio. Uma planilha com essa
 * data entraria como se estivesse certa e a diferença apareceria só meses
 * depois, num relatório de vencimento. A verificação é de ida e volta: a data
 * lida tem de ser exatamente a mesma que foi escrita.
 */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Garantia vigente.
 *
 * `warranty_until` é uma DATA, não um instante: garantia "até 28/08" cobre o
 * dia 28 inteiro, e não expira às 00:00 dele. Comparar `Date` com `Date` faria
 * a garantia acabar de madrugada — e a pessoa que ligasse à tarde do último dia
 * ouviria que não tem cobertura.
 *
 * A comparação é em UTC. Ajustar para o fuso da organização é assunto de onde
 * já existe fuso resolvido — o relógio de SLA (§13) — e não deste utilitário.
 */
export function isUnderWarranty(warrantyUntil: string | null | undefined, now: Date): boolean {
  if (!warrantyUntil || !isValidIsoDate(warrantyUntil)) return false;
  return now.toISOString().slice(0, 10) <= warrantyUntil;
}

/* -------------------------------------------------------------------------- */
/* importação                                                                  */
/* -------------------------------------------------------------------------- */

export interface AssetImportRow {
  readonly line: number;
  readonly name?: string;
  readonly tag?: string | null;
  readonly serial_number?: string | null;
  readonly asset_number?: string | null;
  readonly category?: string;
  readonly manufacturer?: string | null;
  readonly model?: string | null;
  readonly location_code?: string | null;
  readonly acquired_at?: string | null;
  readonly purchase_value?: string | number | null;
  /** Identificador no sistema de origem; a origem vem do lote, não da linha. */
  readonly external_id?: string | null;
}

export interface ImportIssue {
  readonly line: number;
  readonly field: string | null;
  readonly message: string;
}

/**
 * Valida a forma de uma linha de importação antes de tocar o banco.
 *
 * O critério de aceite do épico pede relatório de erro POR LINHA, e é o que
 * torna uma planilha de 27 mil linhas utilizável: recusar o arquivo inteiro por
 * causa de trinta linhas ruins obriga alguém a caçar as trinta sem ajuda
 * nenhuma. Aqui o que dá para julgar sem o banco é julgado aqui, barato, e o
 * resto — existência de categoria, colisão de série — cai na validação do
 * banco linha a linha.
 */
export function validateImportRow(row: AssetImportRow): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const add = (field: string | null, message: string) => issues.push({ line: row.line, field, message });

  if (!row.name || row.name.trim().length === 0) add('name', 'nome é obrigatório');
  else if (row.name.length > 200) add('name', 'nome passa de 200 caracteres');

  if (!row.category || row.category.trim().length === 0) add('category', 'categoria é obrigatória');

  // Modelo sem fabricante não tem onde ser pendurado. O contrário é aceitável:
  // fabricante conhecido e modelo desconhecido é o caso comum na planilha real.
  if (row.model && row.model.trim() && !(row.manufacturer && row.manufacturer.trim())) {
    add('manufacturer', 'modelo informado sem fabricante');
  }

  for (const campo of ['acquired_at'] as const) {
    const v = row[campo];
    if (!v) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) add(campo, 'data deve estar no formato AAAA-MM-DD');
    else if (!isValidIsoDate(v)) add(campo, 'data inexistente no calendário');
  }

  if (row.purchase_value !== undefined && row.purchase_value !== null && row.purchase_value !== '') {
    const n = typeof row.purchase_value === 'number' ? row.purchase_value : Number(row.purchase_value);
    if (!Number.isFinite(n)) add('purchase_value', 'valor de compra não é um número');
    else if (n < 0) add('purchase_value', 'valor de compra negativo');
  }

  return issues;
}
