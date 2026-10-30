/**
 * Aurora — classificação do cliente (reunião 16/10/2026, Fase 2).
 *
 * Dois conceitos, que o cliente pediu explicitamente separados:
 *
 *   EAS — Estabelecimento Assistencial de Saúde: hospital, clínica, consultório,
 *         laboratório, clínica de imagem, home care…
 *   EMPRESA CORPORATIVA — engenharia clínica, assistência técnica, prestadora
 *         de serviço…
 *
 * O SUBTIPO é uma lista curta por conceito, com "outro" — não uma árvore rígida.
 * Segmento livre (`customers.segment`) continua existindo para o que vinha de
 * antes e para importação.
 */
export const CUSTOMER_KINDS = ['eas', 'corporate'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

export const CUSTOMER_KIND_LABEL: Record<CustomerKind, string> = {
  eas: 'EAS — Estabelecimento Assistencial de Saúde',
  corporate: 'Empresa corporativa',
};

export const CUSTOMER_SUBTYPES: Record<CustomerKind, readonly { key: string; label: string }[]> = {
  eas: [
    { key: 'hospital', label: 'Hospital' },
    { key: 'clinica', label: 'Clínica' },
    { key: 'consultorio', label: 'Consultório' },
    { key: 'laboratorio', label: 'Laboratório' },
    { key: 'clinica_imagem', label: 'Clínica de imagem' },
    { key: 'home_care', label: 'Home care' },
    { key: 'outro_eas', label: 'Outro EAS' },
  ],
  corporate: [
    { key: 'engenharia_clinica', label: 'Empresa de engenharia clínica' },
    { key: 'assistencia_tecnica', label: 'Empresa de assistência técnica' },
    { key: 'prestadora_servico', label: 'Empresa prestadora de serviço' },
    { key: 'outro_corporativo', label: 'Outra empresa' },
  ],
};

export function isValidCustomerSubtype(kind: string, subtype: string | null | undefined): boolean {
  if (subtype === null || subtype === undefined) return true;
  const lista = CUSTOMER_SUBTYPES[kind as CustomerKind];
  return Boolean(lista?.some((s) => s.key === subtype));
}

export function customerSubtypeLabel(subtype: string | null | undefined): string | null {
  if (!subtype) return null;
  for (const k of CUSTOMER_KINDS) {
    const s = CUSTOMER_SUBTYPES[k].find((x) => x.key === subtype);
    if (s) return s.label;
  }
  return subtype;
}

/**
 * Setores comuns oferecidos como atalho de NOME (não enum): o cliente digita
 * qualquer outro em "Novo setor". O setor sempre pertence a um cliente.
 */
export const COMMON_SECTORS: readonly string[] = Object.freeze([
  'UTI',
  'Bloco Cirúrgico',
  'Pronto Atendimento',
  'Enfermaria',
  'Imaginologia',
]);

/* -------------------------------------------------------------------------- */
/* vigência do contrato (CLI-06 · pedido do cliente, 19/10/2026 · 0085)        */
/* -------------------------------------------------------------------------- */

/**
 * A situação da vigência, DERIVADA das duas datas e do dia de hoje — nunca
 * gravada: gravada, envelheceria sozinha e mentiria no dia seguinte.
 *
 *   · not_informed — sem datas no cadastro;
 *   · not_started  — o início ainda não chegou;
 *   · expired      — o fim já passou;
 *   · expiring     — vigente, e o fim cai nos próximos 30 dias (inclusive);
 *   · active       — vigente, com mais de 30 dias pela frente.
 *
 * O último dia da vigência ainda é vigente: "até 31/12" inclui o dia 31.
 */
export const CONTRACT_TERM_STATUSES = [
  'active',
  'expiring',
  'expired',
  'not_started',
  'not_informed',
] as const;
export type ContractTermStatus = (typeof CONTRACT_TERM_STATUSES)[number];

/** Quantos dias antes do fim a vigência passa a "vence em breve". */
export const CONTRACT_EXPIRING_DAYS = 30;

/** Dias de calendário entre dois AAAA-MM-DD (b − a). */
function diasEntre(a: string, b: string): number {
  const ms = (d: string) =>
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** `hoje` é o dia de calendário (AAAA-MM-DD) no fuso da organização — ver `localDay`. */
export function contractTermStatus(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
  hoje: string
): ContractTermStatus {
  if (!startsOn || !endsOn) return 'not_informed';
  const inicio = startsOn.slice(0, 10);
  const fim = endsOn.slice(0, 10);
  if (fim < hoje) return 'expired';
  if (inicio > hoje) return 'not_started';
  return diasEntre(hoje, fim) <= CONTRACT_EXPIRING_DAYS ? 'expiring' : 'active';
}
