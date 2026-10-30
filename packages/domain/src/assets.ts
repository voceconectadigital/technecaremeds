/**
 * Aurora — ativos (SPEC v0.2 §07, ADR-006 · EPIC-005).
 *
 * `asset` é o conceito universal; "Equipamento" é apenas o rótulo pt-BR da
 * vertical clínica. Não existe entidade `equipment` — `organization.asset_label`
 * define o termo exibido, e toda a interface o usa.
 */
import { ValidationError } from './errors';
import { contentMatchesDeclaredType } from './attachments';

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
 * Situação do registro ANVISA, como foi VERIFICADA (migration 0081). Sem verificação, nenhuma
 * situação: "regular" afirmaria algo que ninguém conferiu.
 */
export const ANVISA_STATUSES = ['regular', 'alert', 'prohibited'] as const;
export type AnvisaStatus = (typeof ANVISA_STATUSES)[number];
export const ANVISA_STATUS_LABELS: Record<AnvisaStatus, string> = {
  regular: 'Regular',
  alert: 'Alerta',
  prohibited: 'Uso proibido',
};

/**
 * Depreciação em LINHA RETA (o "cálculo comum de depreciação de bens", pedido do
 * cliente em 21/10/2026): o valor depreciável (compra − residual) se distribui por
 * igual ao longo da vida útil, contada a partir da data de aquisição.
 *
 * Duas coisas são devolvidas separadas de propósito:
 *   · o PERCENTUAL e os ANOS — dependem só de data e vida útil, e a barra da ficha os
 *     mostra a quem pode ver o equipamento;
 *   · os VALORES — dependem do valor de compra, que é dado financeiro. Chegam `null`
 *     quando o valor não foi informado (ou quem pede não pode vê-lo: a API nem o lê).
 *
 * `null` quando faltam data de aquisição válida ou vida útil: sem esses dois não há
 * o que depreciar, e "0 % depreciado" seria afirmar que o bem é novo.
 */
export const DEPRECIATION_METHOD = 'straight_line' as const;
export type DepreciationMethod = typeof DEPRECIATION_METHOD;

/**
 * A metodologia, explícita (ATV-10): quem lê o número vê COMO ele foi feito — método, data-base,
 * vida útil e residual. Não há escolha de outro método: linha reta é o "cálculo comum" pedido, e
 * nenhuma norma contábil é inventada aqui.
 */
export interface DepreciationMethodology {
  method: DepreciationMethod;
  /** Data-base: a data de aquisição (AAAA-MM-DD). */
  baseDate: string;
  usefulLifeYears: number;
  /** Data em que o bem fica totalmente depreciado (data-base + vida útil). */
  endDate: string;
  /** Valor residual considerado (0 quando não informado). `null` sem valor de compra. */
  residualValue: number | null;
  /** Compra − residual: o que se distribui ao longo da vida útil. `null` sem valor de compra. */
  depreciableBase: number | null;
}

export interface Depreciation {
  methodology: DepreciationMethodology;
  /** Anos desde a aquisição, limitado à vida útil. */
  elapsedYears: number;
  /** Anos que restam (nunca negativo). */
  remainingYears: number;
  /** 0–100, limitado. */
  percentDepreciated: number;
  fullyDepreciated: boolean;
  /** Depreciação por ano, e acumulada: `null` sem valor de compra. */
  annualDepreciation: number | null;
  accumulatedDepreciation: number | null;
  /** Valor contábil atual (compra − acumulada): `null` sem valor de compra. */
  bookValue: number | null;
}

export function straightLineDepreciation(input: {
  acquiredAt: string | null | undefined;
  usefulLifeYears: number | null | undefined;
  purchaseValue?: number | null;
  residualValue?: number | null;
  now: Date;
}): Depreciation | null {
  const { acquiredAt, usefulLifeYears, now } = input;
  if (!acquiredAt || !usefulLifeYears || usefulLifeYears <= 0) return null;
  const inicio = new Date(acquiredAt);
  if (Number.isNaN(inicio.getTime())) return null;

  const decorrido = Math.max(0, (now.getTime() - inicio.getTime()) / (365.2425 * 24 * 60 * 60 * 1000));
  const anos = Math.min(decorrido, usefulLifeYears);
  const percentual = (anos / usefulLifeYears) * 100;

  const compra = input.purchaseValue ?? null;
  const residual = input.residualValue ?? 0;
  const baseDepreciavel = compra === null ? null : Math.max(0, compra - residual);
  const arred = (n: number) => Math.round(n * 100) / 100;

  // Fim da vida útil: a data-base somada dos anos inteiros (29/02 cai em 01/03 em ano comum).
  const fim = new Date(
    Date.UTC(inicio.getUTCFullYear() + usefulLifeYears, inicio.getUTCMonth(), inicio.getUTCDate())
  );

  return {
    methodology: {
      method: DEPRECIATION_METHOD,
      baseDate: inicio.toISOString().slice(0, 10),
      usefulLifeYears,
      endDate: fim.toISOString().slice(0, 10),
      residualValue: compra === null ? null : arred(Math.min(residual, compra)),
      depreciableBase: baseDepreciavel === null ? null : arred(baseDepreciavel),
    },
    elapsedYears: Math.round(anos * 100) / 100,
    remainingYears: Math.round((usefulLifeYears - anos) * 100) / 100,
    percentDepreciated: Math.round(percentual * 10) / 10,
    fullyDepreciated: decorrido >= usefulLifeYears,
    annualDepreciation: baseDepreciavel === null ? null : arred(baseDepreciavel / usefulLifeYears),
    accumulatedDepreciation: baseDepreciavel === null ? null : arred((baseDepreciavel * percentual) / 100),
    bookValue:
      compra === null || baseDepreciavel === null
        ? null
        : arred(compra - (baseDepreciavel * percentual) / 100),
  };
}

/**
 * Valor residual coerente com o valor de compra (ATV-10): não negativo e não maior que a compra —
 * residual acima da compra daria depreciação negativa, e o cálculo a esconderia (base 0).
 * `null`/ausente vale 0. Sem valor de compra conhecido não há com o que comparar.
 */
export function assertResidualValue(
  purchaseValue: number | null | undefined,
  residualValue: number | null | undefined
): void {
  if (residualValue === null || residualValue === undefined) return;
  if (!Number.isFinite(residualValue) || residualValue < 0) {
    throw new ValidationError('o valor residual não pode ser negativo', { field: 'residual_value' });
  }
  if (purchaseValue !== null && purchaseValue !== undefined && residualValue > purchaseValue) {
    throw new ValidationError('o valor residual não pode ser maior que o valor de compra', {
      field: 'residual_value',
    });
  }
}

/**
 * Registro ANVISA × "não se aplica" (ATV-11): um OU outro. Número e "não se aplica" juntos se
 * contradizem; o banco tem a mesma regra (`assets_anvisa_na_exclusive`, 0089).
 */
export function assertAnvisaConsistency(
  registration: string | null | undefined,
  notApplicable: boolean | null | undefined
): void {
  if (notApplicable && registration && registration.trim() !== '') {
    throw new ValidationError(
      'registro ANVISA e "não se aplica" não andam juntos: informe o número ou marque que não se aplica',
      { field: 'anvisa_not_applicable' }
    );
  }
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

/* -------------------------------------------------------------------------- */
/* foto do equipamento (ATV-07 · pedido do cliente, 19/10/2026 · 0085)         */
/* -------------------------------------------------------------------------- */

/**
 * O que a foto do equipamento pode ser: imagem que o navegador mostra e a
 * impressão leva. HEIC (padrão do iPhone) fica de fora de propósito — o
 * navegador do computador não o desenha, e a ficha impressa sairia sem foto.
 */
export const ASSET_PHOTO_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AssetPhotoContentType = (typeof ASSET_PHOTO_CONTENT_TYPES)[number];

/**
 * 8 MB. A foto de antes/depois aceita 15 MB, mas sobe em fatias; a do
 * equipamento viaja INTEIRA dentro do JSON do cadastro (para que o ativo e a
 * foto nasçam na mesma transação), e o JSON da API tem teto de 12 MB — 8 MB
 * em base64 são ~10,7 MB. Uma foto de celular em qualidade alta fica entre 3 e
 * 8 MB. O banco tem o mesmo teto (`assets_photo_size_valid`).
 */
export const MAX_ASSET_PHOTO_BYTES = 8 * 1024 * 1024;

export const ASSET_PHOTO_EXTENSION: Record<AssetPhotoContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Confere a foto pelos BYTES, não só pelo que foi declarado.
 *
 * O tipo declarado é escrito por quem envia; um "image/png" que é HTML vira
 * XSS armazenado quando servido de volta. Por isso o tipo real é conferido
 * pelos números mágicos (`contentMatchesDeclaredType`, o mesmo da subida de
 * anexo), e o tamanho é o dos bytes decodificados.
 */
export function validateAssetPhoto(contentType: string, bytes: Uint8Array): AssetPhotoContentType {
  const tipo = String(contentType || '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  if (!(ASSET_PHOTO_CONTENT_TYPES as readonly string[]).includes(tipo)) {
    throw new ValidationError('a foto do equipamento precisa ser PNG, JPEG ou WebP', {
      field: 'photo',
      allowed: ASSET_PHOTO_CONTENT_TYPES,
    });
  }
  if (bytes.byteLength === 0) {
    throw new ValidationError('a foto do equipamento veio vazia', { field: 'photo' });
  }
  if (bytes.byteLength > MAX_ASSET_PHOTO_BYTES) {
    throw new ValidationError('a foto do equipamento passa de 8 MB', {
      field: 'photo',
      max: MAX_ASSET_PHOTO_BYTES,
    });
  }
  if (!contentMatchesDeclaredType(tipo, bytes.subarray(0, 16))) {
    throw new ValidationError('o conteúdo do arquivo não é a imagem declarada', { field: 'photo' });
  }
  return tipo as AssetPhotoContentType;
}
