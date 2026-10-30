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

/**
 * O conselho EXIGIDO pela profissão (USR-04 · reunião 16/10/2026): "conselhos profissionais
 * exigidos apenas conforme profissão, não todos simultaneamente".
 *
 * Só as profissões da lista de sugestões (mais a fisioterapia, citada pelo cliente) têm conselho
 * obrigatório, e cada uma exige UM tipo de registro, dos que o cadastro já conhece:
 *
 *   Médico(a) → CRM · Enfermeiro(a), Técnico(a)/Auxiliar de enfermagem → COREN ·
 *   Engenheiro(a) → CREA · Técnico(a) → CFT (o registro é no CRT da região, sob o CFT) ·
 *   Fisioterapeuta → CREFITO.
 *
 * Profissão fora disso (Comprador, Gerente, Diretor, Empresário, texto livre) não exige nada. A
 * comparação é pelo texto normalizado — sem acento, sem "(a)", sem diferença de caixa.
 */
const CONSELHO_POR_PROFISSAO: ReadonlyMap<string, string> = new Map([
  ['medico', 'CRM'],
  ['medica', 'CRM'],
  ['enfermeiro', 'COREN'],
  ['enfermeira', 'COREN'],
  ['tecnico de enfermagem', 'COREN'],
  ['tecnica de enfermagem', 'COREN'],
  ['auxiliar de enfermagem', 'COREN'],
  ['engenheiro', 'CREA'],
  ['engenheira', 'CREA'],
  ['tecnico', 'CFT'],
  ['tecnica', 'CFT'],
  ['fisioterapeuta', 'CREFITO'],
]);

function normalizarProfissao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\((a|o|as|os)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** O tipo de registro que a profissão exige, ou `null` quando ela não exige conselho. */
export function requiredRegistrationKind(jobTitle: string | null | undefined): string | null {
  if (!jobTitle) return null;
  return CONSELHO_POR_PROFISSAO.get(normalizarProfissao(jobTitle)) ?? null;
}

/**
 * Confere a profissão contra os registros. Devolve a mensagem do que falta, ou `null` quando está
 * em ordem. Só o conselho da profissão é exigido — os demais registros são livres.
 */
export function missingRegistrationForProfession(
  jobTitle: string | null | undefined,
  registrations: readonly { kind: string }[]
): string | null {
  const exigido = requiredRegistrationKind(jobTitle);
  if (!exigido) return null;
  if (registrations.some((r) => r.kind.trim().toUpperCase() === exigido)) return null;
  return `a profissão "${jobTitle}" exige o registro no ${exigido}`;
}

/* -------------------------------------------------------------------------- */
/* Telefone (Brasil)                                                          */
/* -------------------------------------------------------------------------- */

/** DDDs em uso no Brasil (plano de numeração da Anatel). */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46,
  47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85,
  86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Telefone brasileiro COM DDD: fixo (DDD + 8 dígitos começando de 2 a 5) ou celular (DDD + 9 +
 * 8 dígitos). Aceita o que se digita — "+55 (31) 99999-0000", "31 3333-0000", "5531999990000" — e
 * devolve só os dígitos nacionais (DDD + número), ou `null` quando não é um telefone válido.
 */
export function normalizeBrazilianPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (!DDDS.has(Number(d.slice(0, 2)))) return null;
  const numero = d.slice(2);
  if (numero.length === 9 && numero[0] !== '9') return null;
  if (numero.length === 8 && !/^[2-5]/.test(numero)) return null;
  return d;
}

export function isValidBrazilianPhone(raw: string): boolean {
  return normalizeBrazilianPhone(raw) !== null;
}

/** `(31) 99999-0000` (celular) ou `(31) 3333-0000` (fixo). */
export function formatBrazilianPhone(raw: string): string {
  const d = normalizeBrazilianPhone(raw);
  if (!d) return raw;
  const n = d.slice(2);
  return `(${d.slice(0, 2)}) ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* CNPJ                                                                       */
/* -------------------------------------------------------------------------- */

/** Sem pontuação, em maiúsculas (o CNPJ alfanumérico tem letras nas 12 primeiras posições). */
export function normalizeCnpj(raw: string): string {
  return raw.replace(/[\s./-]/g, '').toUpperCase();
}

/**
 * CNPJ válido pelos dígitos verificadores (módulo 11, pesos 5..2,9..2 e 6..2,9..2). Aceita o
 * formato numérico e o ALFANUMÉRICO da Receita (12 posições de 0-9/A-Z + 2 dígitos verificadores,
 * cada caractere valendo o código ASCII − 48 — para os dígitos, o próprio número).
 */
export function isValidCnpj(raw: string): boolean {
  const c = normalizeCnpj(raw);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c)) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const valor = (ch: string) => ch.charCodeAt(0) - 48;
  const dv = (base: string): number => {
    const pesos =
      base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((acc, ch, i) => acc + valor(ch) * pesos[i]!, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + String(d1));
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

/** `12.345.678/0001-95`. */
export function formatCnpj(raw: string): string {
  const c = normalizeCnpj(raw);
  return c.length === 14
    ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    : raw;
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
