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
