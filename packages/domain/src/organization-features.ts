/**
 * Aurora — modo de uso e recursos habilitados por organização
 * (0049 · gap V2 P0.4 · PLAT §2 e §4 "Identidade → recursos habilitados").
 *
 * UMA PLATAFORMA, CONFIGURAÇÃO DIFERENTE — e não cinco sistemas.
 *
 * O PLAT §2 descreve cinco públicos: prestadora de serviço, hospital,
 * fabricante, consultoria e laboratório de instrumentação. A resposta errada
 * seria um `if (modo === 'hospital')` espalhado pelas telas. A resposta certa é
 * DADO: a organização declara o modo e a lista de módulos que usa, e quem
 * monta menu e tela lê a lista.
 *
 * O QUE ESTE MÓDULO NÃO DECIDE
 *
 * Qual módulo cada modo usa POR PADRÃO é decisão do cliente (auditoria de gap,
 * VAL-C de P0.4). Até aqui só uma foi tomada — hospital não usa orçamento (ver
 * `FEATURES_OFF_BY_DEFAULT`). Fora isso, o padrão é o mais conservador
 * possível: TODOS os módulos habilitados. Inventar que "hospital não usa
 * estoque" desligaria uma tela de alguém sem que ninguém tenha decidido isso.
 *
 * Também não é autorização. Recurso habilitado diz o que a organização USA;
 * quem pode o quê continua sendo o RBAC. Desligar um recurso esconde o
 * módulo, não substitui permissão.
 */
import { ValidationError } from './errors';

export const ORGANIZATION_USAGE_MODES = [
  'service_provider',
  'hospital',
  'manufacturer',
  'consultancy',
  'laboratory',
] as const;
export type OrganizationUsageMode = (typeof ORGANIZATION_USAGE_MODES)[number];

export const USAGE_MODE_LABELS: Record<OrganizationUsageMode, string> = {
  service_provider: 'Prestadora de serviço',
  hospital: 'Hospital',
  manufacturer: 'Fabricante',
  consultancy: 'Consultoria',
  laboratory: 'Laboratório de instrumentação',
};

/**
 * Os módulos do PLAT §4, e só eles.
 *
 * Lista fechada em código, como as permissões: um recurso só existe se houver
 * tela ou rota que o leia. Não são planos comerciais — são os módulos que a
 * especificação já descreve.
 */
export const ORGANIZATION_FEATURES = [
  'assets',
  'service_requests',
  'work_orders',
  'maintenance_plans',
  'metrology',
  'documents',
  'inventory',
  'contracts',
  'quotes',
  'portal',
  'insights',
  'opportunities',
  'imports',
  'automations',
] as const;
export type OrganizationFeature = (typeof ORGANIZATION_FEATURES)[number];

/**
 * O que um modo NÃO usa enquanto ninguém configurou a lista.
 *
 * Uma única decisão tomada até aqui (auditoria de 29/10/2026, OS-03 · ORC-01 ·
 * CLI-07, sobre a reunião de 16/10): orçamento é coisa de PRESTADORA. O hospital
 * que opera o próprio estabelecimento não orça para si mesmo — então, no modo
 * `hospital`, o recurso `quotes` nasce desligado e as etapas "Aguardando
 * aprovação do orçamento"/"Orçamento aprovado" e o botão "Gerar orçamento"
 * somem. Ligar de volta é escolher a lista (`enabled_features` com `quotes`).
 *
 * Os demais modos continuam com tudo: para eles ninguém decidiu nada.
 */
export const FEATURES_OFF_BY_DEFAULT: Readonly<
  Partial<Record<OrganizationUsageMode, readonly OrganizationFeature[]>>
> = Object.freeze({ hospital: ['quotes'] as const });

/**
 * A lista efetiva.
 *
 * `null` no banco quer dizer "nunca configurado" — e nunca configurado é tudo
 * habilitado, menos o que o modo declaradamente não usa
 * (`FEATURES_OFF_BY_DEFAULT`). Guardar a lista inteira desde o início faria todo
 * módulo novo nascer DESLIGADO para quem já existia, sem que ninguém tivesse
 * escolhido isso.
 */
export function effectiveFeatures(
  stored: readonly string[] | null | undefined,
  mode?: OrganizationUsageMode | string | null
): OrganizationFeature[] {
  if (stored === null || stored === undefined) {
    const fora = (mode ? FEATURES_OFF_BY_DEFAULT[mode as OrganizationUsageMode] : undefined) ?? [];
    return ORGANIZATION_FEATURES.filter((f) => !fora.includes(f));
  }
  return ORGANIZATION_FEATURES.filter((f) => stored.includes(f));
}

/** Confere uma lista enviada: sem desconhecidos, sem repetidos, em ordem canônica. */
export function normalizeFeatures(input: readonly string[]): OrganizationFeature[] {
  const desconhecidos = input.filter((f) => !(ORGANIZATION_FEATURES as readonly string[]).includes(f));
  if (desconhecidos.length > 0) {
    throw new ValidationError(`recurso desconhecido: ${desconhecidos.join(', ')}`, {
      field: 'enabled_features',
      allowed: ORGANIZATION_FEATURES,
    });
  }
  return ORGANIZATION_FEATURES.filter((f) => input.includes(f));
}
