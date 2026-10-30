/**
 * Aurora — do relatório à automação (REL-15, 29/10/2026).
 *
 * "Criar automação com estes filtros": o diálogo de relatório entrega o que a pessoa escolheu, e
 * a "Nova automação" abre no modelo de relatório agendado, já preenchida. A tradução mora aqui,
 * num lugar só e sem tela, para a ida (relatório → automação) e a volta (automação → parâmetros
 * da ação `send_report`) não divergirem.
 *
 * O período NÃO vai junto: o relatório agendado tem o seu (últimos N dias ou mês anterior). A
 * trava do nível contratado vale do mesmo jeito na automação — o servidor confere ao salvar.
 */
export type NivelDoRelatorio = 'basic' | 'advanced' | 'expert';

/** O que o gerador de relatório manda ao servidor (o corpo de `POST /reports/generate`). */
export interface FiltrosDoRelatorio {
  tier: NivelDoRelatorio;
  indicators?: string[];
  customer_id?: string;
  sector_id?: string;
  plan_kind?: string;
  asset_category_id?: string;
  work_order_type?: string;
}

/** Os campos da "Nova automação" de relatório agendado. Vazio = sem filtro. */
export interface RelatorioAgendadoInicial {
  nome: string;
  tier: NivelDoRelatorio;
  indicadores: string[];
  cliente: string;
  setor: string;
  tipoDePlano: string;
  categoria: string;
  tipoDeManutencao: string;
}

const NOMES: Record<NivelDoRelatorio, string> = { basic: 'Basic', advanced: 'Advanced', expert: 'Expert' };

export function automacaoDoRelatorio(
  f: FiltrosDoRelatorio,
  nomeDoCliente?: string
): RelatorioAgendadoInicial {
  return {
    nome: `Relatório ${NOMES[f.tier]}${nomeDoCliente ? ` — ${nomeDoCliente}` : ''}`,
    tier: f.tier,
    indicadores: [...(f.indicators ?? [])],
    cliente: f.customer_id ?? '',
    setor: f.sector_id ?? '',
    tipoDePlano: f.plan_kind ?? '',
    categoria: f.asset_category_id ?? '',
    tipoDeManutencao: f.work_order_type ?? '',
  };
}

/** Os parâmetros do recorte na ação `send_report` (sem destinatários e sem período). */
export function parametrosDoRecorte(
  i: Pick<
    RelatorioAgendadoInicial,
    'tier' | 'indicadores' | 'cliente' | 'setor' | 'tipoDePlano' | 'categoria' | 'tipoDeManutencao'
  >
): Record<string, unknown> {
  return {
    tier: i.tier,
    ...(i.indicadores.length > 0 ? { indicators: i.indicadores } : {}),
    ...(i.cliente ? { customerId: i.cliente } : {}),
    ...(i.setor ? { sectorId: i.setor } : {}),
    ...(i.tipoDePlano ? { planKind: i.tipoDePlano } : {}),
    ...(i.categoria ? { assetCategoryId: i.categoria } : {}),
    ...(i.tipoDeManutencao ? { workOrderType: i.tipoDeManutencao } : {}),
  };
}
