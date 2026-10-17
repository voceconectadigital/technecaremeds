/**
 * Aurora — perfis de acesso, profissão e dados de cadastro de pessoas.
 * (Reunião de 16/10/2026, Fase 1.)
 *
 * TRÊS COISAS DIFERENTES, QUE ESTE MÓDULO MANTÉM SEPARADAS
 *
 *   1. PERFIL DE ACESSO — OPERADOR, SOLICITANTE ou GESTOR. É a pergunta "o que a
 *      pessoa pode fazer aqui?". Cada perfil aponta para UM papel de fábrica do
 *      RBAC existente (`permissions.ts`). Não existe segundo sistema de
 *      permissões: o perfil é só a forma comercial de escolher um papel.
 *
 *   2. PROFISSÃO — médico, enfermeiro, engenheiro… É a pergunta "o que a pessoa
 *      é?". É texto de cadastro. **Nenhuma profissão concede permissão**:
 *      engenheiro que precise de mais acesso recebe um papel extra ou uma
 *      permissão individual, com motivo, pelos mecanismos que já existem.
 *
 *   3. ESCOPO — organização → cliente/hospital → setor(es). É a pergunta "sobre
 *      o quê?". Mora em `membership_scopes` e é aplicado no servidor.
 */

/* -------------------------------------------------------------------------- */
/* Perfis de acesso                                                           */
/* -------------------------------------------------------------------------- */

export const BUSINESS_PROFILE_KEYS = ['operator', 'requester', 'manager'] as const;
export type BusinessProfileKey = (typeof BUSINESS_PROFILE_KEYS)[number];

export interface BusinessProfile {
  readonly key: BusinessProfileKey;
  readonly label: string;
  readonly description: string;
  /** Chave do papel de fábrica que o perfil concede. */
  readonly roleKey: string;
  readonly seatType: 'staff' | 'portal';
}

export const BUSINESS_PROFILES: readonly BusinessProfile[] = Object.freeze([
  {
    key: 'operator',
    label: 'Operador',
    description: 'Executa a operação técnica: atende ordens, preenche procedimentos e usa peças.',
    roleKey: 'operator',
    seatType: 'staff',
  },
  {
    key: 'requester',
    label: 'Solicitante',
    description:
      'Abre e acompanha solicitações do que está no seu escopo, avalia o atendimento e aprova orçamento.',
    roleKey: 'requester',
    seatType: 'portal',
  },
  {
    key: 'manager',
    label: 'Gestor',
    description: 'Visão ampliada dentro do próprio escopo: estoque, orçamentos, indicadores e usuários.',
    roleKey: 'manager',
    seatType: 'staff',
  },
]);

export function profileOf(key: string): BusinessProfile | undefined {
  return BUSINESS_PROFILES.find((p) => p.key === key);
}

/** O perfil de negócio que um conjunto de papéis representa, se algum. */
export function profileOfRoles(roleKeys: readonly string[]): BusinessProfile | undefined {
  return BUSINESS_PROFILES.find((p) => roleKeys.includes(p.roleKey));
}

/* -------------------------------------------------------------------------- */
/* Profissão e registros profissionais                                        */
/* -------------------------------------------------------------------------- */

/**
 * Sugestões de profissão — TEXTO DE CADASTRO. Não é enum, não é permissão: a
 * lista só ajuda a digitar. `outro` e texto livre são aceitos.
 */
export const PROFESSION_SUGGESTIONS: readonly string[] = Object.freeze([
  'Médico(a)',
  'Enfermeiro(a)',
  'Técnico(a) de enfermagem',
  'Auxiliar de enfermagem',
  'Engenheiro(a)',
  'Técnico(a)',
  'Comprador(a)',
  'Gerente',
  'Diretor(a)',
  'Empresário(a)',
]);

/**
 * Tipo do registro profissional. O cadastro guarda PAR (tipo, número), podendo
 * haver mais de um por pessoa — nunca uma coluna por conselho.
 */
export const REGISTRATION_KINDS: readonly { key: string; label: string }[] = Object.freeze([
  { key: 'CRM', label: 'CRM — Medicina' },
  { key: 'COREN', label: 'COREN — Enfermagem' },
  { key: 'CREA', label: 'CREA — Engenharia' },
  { key: 'CFT', label: 'CFT — Técnicos industriais' },
  { key: 'CREFITO', label: 'CREFITO — Fisioterapia e terapia ocupacional' },
  { key: 'OAB', label: 'OAB — Advocacia' },
  { key: 'OUTRO', label: 'Outro' },
]);

const REGISTRATION_KIND_KEYS = new Set(REGISTRATION_KINDS.map((k) => k.key));

export function isKnownRegistrationKind(key: string): boolean {
  return REGISTRATION_KIND_KEYS.has(key);
}

const UFS = new Set([
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
]);

export function isKnownUf(uf: string): boolean {
  return UFS.has(uf);
}

/** Número de registro: letras, dígitos e separadores comuns; sem espaços nas pontas. */
export function normalizeRegistrationNumber(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidRegistrationNumber(raw: string): boolean {
  return /^[A-Z0-9][A-Z0-9./-]{1,23}$/.test(normalizeRegistrationNumber(raw));
}

/* -------------------------------------------------------------------------- */
/* CPF                                                                        */
/* -------------------------------------------------------------------------- */

/** Só os dígitos. */
export function normalizeCpf(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** CPF válido: 11 dígitos, não repetidos, com os dois dígitos verificadores corretos. */
export function isValidCpf(raw: string): boolean {
  const d = normalizeCpf(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}

/** `123.456.789-09`. Para exibição a quem pode ver. */
export function formatCpf(raw: string): string {
  const d = normalizeCpf(raw);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : raw;
}

/** `***.456.789-**` — o que a lista de pessoas mostra por padrão. */
export function maskCpf(raw: string): string {
  const d = normalizeCpf(raw);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '';
}

/* -------------------------------------------------------------------------- */
/* Situação do acesso                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Situação de um vínculo. `active` acessa; `suspended` e `blocked` NÃO acessam.
 *
 *   suspended — pausa administrativa, reversível, com motivo (afastamento,
 *               fim de contrato…). Não é automática por contrato.
 *   blocked   — corte por segurança ou política, com motivo; só quem gerencia
 *               pessoas desbloqueia.
 *
 * Nenhuma das duas apaga o vínculo: a trilha continua tendo dono.
 */
export const ACCESS_STATES = ['active', 'suspended', 'blocked'] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

export const ACCESS_STATE_LABEL: Record<AccessState, string> = {
  active: 'Ativo',
  suspended: 'Suspenso',
  blocked: 'Bloqueado',
};

/** Transições permitidas entre as situações de acesso. */
export function canChangeAccessState(from: string, to: AccessState): boolean {
  if (from === to) return false;
  if (from === 'removed') return false;
  if (to === 'active') return from === 'suspended' || from === 'blocked' || from === 'invited';
  return from === 'active' || from === 'invited' || from === 'suspended' || from === 'blocked';
}
