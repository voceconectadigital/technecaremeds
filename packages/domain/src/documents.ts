/**
 * Aurora — motor único de documentos (SPEC v0.2 §18 · EPIC-018).
 *
 * A referência tem SEIS módulos documentais separados — calibração, rascunho de
 * calibração, certificado de padrão, TSE, laudo de obsolescência, qualificação
 * térmica — com estrutura 90 % comum. Cada um tem a sua tela, a sua numeração,
 * a sua assinatura e o seu jeito de expirar, e as diferenças entre eles são
 * acidentais: nasceram de terem sido escritos em épocas diferentes.
 *
 * Um motor com tipos elimina cinco implementações e torna o sétimo tipo uma
 * linha de configuração. O preço é que as poucas diferenças REAIS precisam ser
 * declaradas em vez de implementadas — é o que `DocumentTypeDefinition` faz.
 *
 * A REGRA QUE ATRAVESSA TUDO: DOCUMENTO ASSINADO NÃO SE EDITA
 *   O `contentHash` é calculado sobre o payload canônico antes da assinatura.
 *   Qualquer alteração posterior invalidaria a assinatura — então a alteração é
 *   recusada, e o caminho é uma versão nova. "Assinado" é uma afirmação sobre um
 *   conteúdo específico; permitir edição depois transformaria a assinatura numa
 *   afirmação sobre nada.
 */
import { createHash } from 'node:crypto';
import type { CustomFieldDefinition } from './custom-fields';
import { validateCustomValues, type ValidationOutcome } from './custom-fields';

/* -------------------------------------------------------------------------- */
/* tipos de documento                                                          */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_TYPE_KEYS = [
  'work_order_report',
  'calibration_certificate',
  'electrical_safety_test',
  'standard_certificate',
  'obsolescence_report',
  'thermal_qualification',
] as const;
export type DocumentTypeKey = (typeof DOCUMENT_TYPE_KEYS)[number];

export interface DocumentTypeDefinition {
  readonly key: DocumentTypeKey;
  readonly label: string;
  /** Série de numeração — o prefixo do número emitido. */
  readonly series: string;
  /** Validade padrão em dias. `null` quando o documento não vence. */
  readonly defaultValidityDays: number | null;
  readonly requiresTechnicalManager: boolean;
  readonly requiresSignature: boolean;
  /** Campos que o payload precisa trazer, na mesma gramática dos campos personalizados. */
  readonly payloadFields: readonly CustomFieldDefinition[];
  /** Fase do produto em que o tipo entra — o MVP tem um só. */
  readonly phase: 'MVP' | 'F2' | 'F3';
}

/**
 * Os tipos previstos no §18, declarados.
 *
 * Só `work_order_report` está no MVP, e os demais estão aqui **sem payload
 * especializado**: as colunas e o motor os aceitam desde já, mas os campos de
 * cada um dependem de norma técnica que a auditoria não confirmou. Inventar os
 * pontos de medição de um certificado de calibração seria escrever no sistema
 * uma exigência metrológica que ninguém verificou — exatamente o tipo de dado
 * que depois vira laudo assinado.
 */
export const DOCUMENT_TYPES: readonly DocumentTypeDefinition[] = Object.freeze([
  {
    key: 'work_order_report',
    label: 'Relatório de OS',
    series: 'REL',
    defaultValidityDays: null,
    requiresTechnicalManager: false,
    requiresSignature: false,
    payloadFields: [],
    phase: 'MVP',
  },
  {
    key: 'calibration_certificate',
    label: 'Certificado de calibração',
    series: 'CAL',
    defaultValidityDays: 365,
    requiresTechnicalManager: true,
    requiresSignature: true,
    payloadFields: [],
    phase: 'F2',
  },
  {
    key: 'electrical_safety_test',
    label: 'Teste de segurança elétrica',
    series: 'TSE',
    defaultValidityDays: 365,
    requiresTechnicalManager: true,
    requiresSignature: true,
    payloadFields: [],
    phase: 'F2',
  },
  {
    key: 'standard_certificate',
    label: 'Certificado de padrão',
    series: 'PAD',
    defaultValidityDays: 365,
    requiresTechnicalManager: false,
    requiresSignature: false,
    payloadFields: [],
    phase: 'F2',
  },
  {
    key: 'obsolescence_report',
    label: 'Laudo de obsolescência',
    series: 'LOB',
    defaultValidityDays: null,
    requiresTechnicalManager: true,
    requiresSignature: true,
    payloadFields: [],
    phase: 'F3',
  },
  {
    key: 'thermal_qualification',
    label: 'Qualificação térmica',
    series: 'QT',
    defaultValidityDays: 365,
    requiresTechnicalManager: true,
    requiresSignature: true,
    payloadFields: [],
    phase: 'F3',
  },
]);

export function documentType(key: string): DocumentTypeDefinition | undefined {
  return DOCUMENT_TYPES.find((t) => t.key === key);
}

/* -------------------------------------------------------------------------- */
/* ciclo de vida                                                               */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_STATUSES = [
  'draft',
  'under_review',
  'issued',
  'released',
  'expired',
  'cancelled',
  'superseded',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface DocumentTransition {
  readonly from: DocumentStatus;
  readonly to: DocumentStatus;
  readonly permission: string;
  readonly label: string;
}

/**
 * O grafo do §18.
 *
 * `cancelled` sai de três situações e `superseded` de quatro, e essa assimetria
 * é proposital: cancelar é dizer que o documento não deveria ter existido;
 * superar é dizer que ele existiu e foi trocado. Só o segundo faz sentido a
 * partir de `expired` — um documento vencido pode ganhar sucessor, mas
 * cancelá-lo depois de vencido reescreveria o passado.
 */
export const DOCUMENT_TRANSITIONS: readonly DocumentTransition[] = Object.freeze([
  { from: 'draft', to: 'under_review', permission: 'document.create', label: 'enviar para revisão' },
  { from: 'draft', to: 'cancelled', permission: 'document.create', label: 'descartar' },
  { from: 'under_review', to: 'draft', permission: 'document.create', label: 'devolver para ajuste' },
  { from: 'under_review', to: 'issued', permission: 'document.issue', label: 'emitir' },
  { from: 'under_review', to: 'cancelled', permission: 'document.issue', label: 'cancelar' },
  {
    from: 'issued',
    to: 'released',
    permission: 'document.release_to_customer',
    label: 'liberar ao cliente',
  },
  { from: 'issued', to: 'cancelled', permission: 'document.issue', label: 'cancelar' },
  { from: 'issued', to: 'expired', permission: 'document.issue', label: 'expirar' },
  { from: 'issued', to: 'superseded', permission: 'document.issue', label: 'substituir' },
  { from: 'released', to: 'cancelled', permission: 'document.issue', label: 'cancelar' },
  { from: 'released', to: 'expired', permission: 'document.issue', label: 'expirar' },
  { from: 'released', to: 'superseded', permission: 'document.issue', label: 'substituir' },
  { from: 'expired', to: 'superseded', permission: 'document.issue', label: 'substituir' },
]);

export function allowedDocumentTransitions(from: DocumentStatus): readonly DocumentTransition[] {
  return DOCUMENT_TRANSITIONS.filter((t) => t.from === from);
}

export function canTransitionDocument(from: DocumentStatus, to: DocumentStatus): DocumentTransition | null {
  return DOCUMENT_TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

/** Situações a partir das quais o documento é só história. */
export const TERMINAL_DOCUMENT_STATUSES: readonly DocumentStatus[] = Object.freeze([
  'cancelled',
  'superseded',
]);

/* -------------------------------------------------------------------------- */
/* veredito                                                                    */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_VERDICTS = [
  'conforming',
  'non_conforming',
  'conforming_with_restriction',
  'na',
] as const;
export type DocumentVerdict = (typeof DOCUMENT_VERDICTS)[number];

export const VERDICT_LABELS: Record<DocumentVerdict, string> = {
  conforming: 'Conforme',
  non_conforming: 'Não conforme',
  conforming_with_restriction: 'Conforme com restrição',
  na: 'Não se aplica',
};

/* -------------------------------------------------------------------------- */
/* numeração                                                                   */
/* -------------------------------------------------------------------------- */

export interface NumberPattern {
  readonly prefix: string;
  readonly suffix?: string;
  /** Casas do sequencial, com zeros à esquerda. */
  readonly digits: number;
  readonly includeYear: boolean;
}

/**
 * Monta o número a partir do padrão.
 *
 * O sequencial é preenchido com zeros à esquerda porque número de documento é
 * lido e comparado por pessoas: `REL-2025-000042` e `REL-2025-000420` se
 * distinguem à primeira vista, `REL-2025-42` e `REL-2025-420` não. E ordenar
 * texto sem zeros à esquerda coloca o 100 antes do 20.
 */
export function formatDocumentNumber(pattern: NumberPattern, sequence: number, year: number): string {
  const partes = [pattern.prefix];
  if (pattern.includeYear) partes.push(String(year));
  partes.push(String(sequence).padStart(pattern.digits, '0'));
  const base = partes.join('-');
  return pattern.suffix ? `${base}-${pattern.suffix}` : base;
}

/* -------------------------------------------------------------------------- */
/* conteúdo e hash                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Forma canônica de um valor, para o hash não depender de detalhes de
 * serialização.
 *
 * `JSON.stringify` preserva a ordem de inserção das chaves, o que significa que
 * o MESMO documento, montado por dois caminhos diferentes, produziria dois
 * hashes diferentes — e a assinatura de um pareceria inválida para o outro.
 * Aqui as chaves saem ordenadas, em toda profundidade.
 *
 * `undefined` é omitido e `null` é preservado: são coisas diferentes. "Campo
 * não informado" e "campo explicitamente vazio" precisam produzir hashes
 * diferentes, porque em laudo essa distinção é conteúdo.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';

  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',')}]`;
  }

  if (typeof value === 'object') {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    const entradas = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entradas.join(',')}}`;
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('número não finito não pode entrar no conteúdo assinado');
  }

  return JSON.stringify(value);
}

/** SHA-256 do conteúdo canônico — o que a assinatura de fato promete. */
export function contentHash(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
}

/* -------------------------------------------------------------------------- */
/* assinatura                                                                  */
/* -------------------------------------------------------------------------- */

export const SIGNATURE_METHODS = ['drawn', 'email_code', 'portal', 'icp_brasil'] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export interface SignatureEvidence {
  readonly method: SignatureMethod;
  readonly signerName: string;
  readonly signerDocument?: string | null;
  readonly signerEmail?: string | null;
  readonly attachmentId?: string | null;
  readonly portalUserId?: string | null;
  readonly certificateSubject?: string | null;
}

/**
 * O que falta para a assinatura ter prova de origem.
 *
 * Cada método tem a sua prova, e assinatura sem prova é só um nome digitado:
 * desenhada precisa da imagem, por código precisa do e-mail que o recebeu,
 * pelo portal precisa do usuário autenticado. `icp_brasil` é futuro e está
 * modelado desde já — mas recusa por enquanto, em vez de aceitar sem verificar,
 * porque aceitar uma assinatura digital sem validar a cadeia seria afirmar
 * validade que o sistema não apurou.
 */
export function signatureBlockers(evidence: SignatureEvidence): string[] {
  const faltas: string[] = [];

  if (evidence.signerName.trim().length < 2) faltas.push('o nome de quem assina é obrigatório');

  switch (evidence.method) {
    case 'drawn':
      if (!evidence.attachmentId) faltas.push('a assinatura desenhada precisa da imagem coletada');
      break;
    case 'email_code':
      if (!evidence.signerEmail) faltas.push('a assinatura por código precisa do e-mail validado');
      break;
    case 'portal':
      if (!evidence.portalUserId) faltas.push('o aceite pelo portal precisa do usuário autenticado');
      break;
    case 'icp_brasil':
      faltas.push(
        'assinatura por certificado digital ainda não é verificada por este sistema: os campos existem, a validação da cadeia não'
      );
      break;
  }

  return faltas;
}

/* -------------------------------------------------------------------------- */
/* emissão                                                                     */
/* -------------------------------------------------------------------------- */

export interface IssueFacts {
  readonly type: DocumentTypeDefinition;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly technicalManagerId: string | null;
  readonly verdict: DocumentVerdict | null;
  readonly signatureCount: number;
}

export interface IssueOutcome {
  readonly ok: boolean;
  readonly blockers: readonly string[];
  readonly payloadIssues: ValidationOutcome['issues'];
}

/**
 * O que impede emitir.
 *
 * Devolve tudo de uma vez — pendências do tipo e do payload juntas —, pela
 * mesma razão do bloco de conclusão da OS: quem descobre um problema por vez
 * volta ao formulário três vezes.
 */
export function checkIssue(facts: IssueFacts): IssueOutcome {
  const faltas: string[] = [];

  if (facts.type.requiresTechnicalManager && !facts.technicalManagerId) {
    faltas.push(`${facts.type.label} exige responsável técnico identificado`);
  }
  if (facts.type.requiresSignature && facts.signatureCount === 0) {
    faltas.push(`${facts.type.label} exige assinatura antes da emissão`);
  }
  if (facts.verdict === null) {
    faltas.push('o veredito precisa ser informado, ainda que seja "não se aplica"');
  }

  const payload = validateCustomValues(facts.type.payloadFields, facts.payload);

  return {
    ok: faltas.length === 0 && payload.issues.length === 0,
    blockers: faltas,
    payloadIssues: payload.issues,
  };
}

/**
 * Validade a partir da emissão.
 *
 * O tipo sem validade padrão devolve `null` — relatório de OS não vence, e
 * atribuir a ele um vencimento arbitrário encheria o painel de "documentos a
 * renovar" que ninguém precisa renovar.
 */
export function validUntilFor(type: DocumentTypeDefinition, issuedAt: Date): Date | null {
  if (type.defaultValidityDays === null) return null;
  return new Date(issuedAt.getTime() + type.defaultValidityDays * 86_400_000);
}

/** Dias até vencer, negativo quando já venceu. `null` para documento sem validade. */
export function daysToExpiry(validUntil: Date | null, now: Date): number | null {
  if (validUntil === null) return null;
  return Math.ceil((validUntil.getTime() - now.getTime()) / 86_400_000);
}

export const EXPIRY_THRESHOLDS = [90, 60, 30, 7] as const;
export type ExpiryThreshold = (typeof EXPIRY_THRESHOLDS)[number];

/**
 * O marco de vencimento cruzado hoje, se houver.
 *
 * Mesmo desenho do aviso de renovação de contrato: o marco MAIS PRÓXIMO já
 * cruzado, para quem chama comparar com o último avisado e não repetir. Um
 * aviso que chega todo dia é um aviso que ninguém lê.
 */
export function expiryThreshold(validUntil: Date | null, now: Date): ExpiryThreshold | null {
  const dias = daysToExpiry(validUntil, now);
  if (dias === null || dias < 0) return null;
  return [...EXPIRY_THRESHOLDS].reverse().find((t) => dias <= t) ?? null;
}
