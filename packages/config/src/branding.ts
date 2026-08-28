/**
 * Aurora — identidade do produto concentrada em um só lugar (OQ-13, default v0.2).
 *
 * "Aurora" é nome de trabalho. Trocar marca, domínio ou textos visíveis deve ser
 * alteração de configuração, nunca refatoração espalhada pelo código.
 */
export const BRANDING = {
  productName: 'Aurora',
  /** Namespace técnico: pacotes, prefixo de variáveis de sessão, chaves de config. */
  technicalNamespace: 'aurora',
  /** Prefixo das variáveis transaction-local no PostgreSQL. */
  sessionVariablePrefix: 'aurora',
  supportEmail: 'suporte@aurora.local',
  documentationUrl: 'https://aurora.local/docs',
} as const;

export type Branding = typeof BRANDING;
