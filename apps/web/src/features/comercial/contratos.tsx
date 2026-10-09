/**
 * Aurora — contratos (SPEC v0.2 §17 · EPIC-017).
 *
 * A COBERTURA É EXPRESSÃO, E NÃO LISTA.
 *
 * "Todos os ventiladores da UTI" continua valendo para o ventilador que chegar
 * amanhã. Uma lista marcada a mão envelhece no dia seguinte, e o ativo que
 * ficou de fora é justamente o que gera a discussão sobre quem paga o conserto.
 *
 * Por isso a ficha mostra DUAS coisas separadas: a expressão, e os ativos que
 * ela alcança HOJE. Mostrar só a expressão deixaria o operador ativar um
 * contrato sem saber que ele cobre trezentos equipamentos; mostrar só a lista
 * esconderia que a lista muda sozinha.
 *
 * O QUE ESTA TELA NÃO MOSTRA A QUEM NÃO PODE VER
 *
 * Valor mensal, taxas de excedente e percentuais de glosa não chegam do
 * servidor sem `contract.read_financials`. O coordenador precisa saber o que o
 * contrato COBRE — é isso que decide se o atendimento está no escopo. O que
 * ele custa é conversa comercial.
 */
import { Link, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Boxes, FileSignature, Search, ShieldCheck, RefreshCw } from 'lucide-react';
import { Card, CardHeader, EmptyState, Select, Skeleton, SkeletonList, StatusChip, cn } from '@aurora/ui';
import {
  contractAssets,
  contractDetail,
  contractsList,
  CONTRACT_STATUSES,
  type ContractCoverage,
  type ContractRow,
  type ContractStatus,
} from '@aurora/contracts';
import { useApiQuery, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { AlternadorComercial } from './alternador';
import { formatarData } from './orcamentos';

const ROTULO: Record<ContractStatus, string> = {
  draft: 'Rascunho',
  active: 'Vigente',
  suspended: 'Suspenso',
  expired: 'Expirado',
  terminated: 'Encerrado',
};

const TOM: Record<ContractStatus, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  draft: 'neutral',
  active: 'good',
  suspended: 'warn',
  expired: 'warn',
  terminated: 'neutral',
};

export function ContratosPage() {
  const [situacao, setSituacao] = useUrlState<string>('situacao', '');
  const [busca, setBusca] = useState('');

  const { data, isLoading, isError, error } = useApiQuery(contractsList, {
    query: situacao ? { status: situacao as ContractStatus } : {},
  }) as {
    data: { items: ContractRow[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const itens = useMemo(() => data?.items ?? [], [data]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return itens;
    return itens.filter(
      (c) => c.number.toLowerCase().includes(termo) || (c.title ?? '').toLowerCase().includes(termo)
    );
  }, [itens, busca]);

  if (isError) return <ErrorScreen error={error} />;

  return (
    <AppShell title="Contratos" subtitle="O que cada acordo cobre, até quando vale, e o que está por vencer.">
      <div className="flex flex-col gap-4">
        <AlternadorComercial />

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-border-subtle p-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
              />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Filtrar por número ou título"
                aria-label="Filtrar contratos"
                className="h-10 w-full rounded-control border border-border bg-surface pr-3 pl-9 text-sm text-text shadow-card transition-[border-color,box-shadow] placeholder:text-subtle focus:border-accent focus:shadow-[0_0_0_3px_var(--aurora-accent-soft)]"
              />
            </div>
            <Select
              value={situacao}
              aria-label="Situação"
              onChange={(e) => setSituacao(e.target.value)}
              className="sm:w-48"
            >
              <option value="">Todas as situações</option>
              {CONTRACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ROTULO[s]}
                </option>
              ))}
            </Select>
          </div>
          {isLoading ? (
            <div className="p-3">
              <SkeletonList rows={6} label="contratos" />
            </div>
          ) : filtrados.length === 0 ? (
            <EmptyState
              icon={<FileSignature className="size-5" />}
              title={itens.length === 0 ? 'Nenhum contrato' : 'Nenhum contrato com esse texto'}
              filtered={itens.length > 0}
              description={
                itens.length === 0
                  ? 'Um contrato diz o que está coberto para cada cliente — locais e equipamentos —, com SLA e modelo de cobrança.'
                  : undefined
              }
              origem="Contratos ficam ligados a um cliente (veja Clientes). A cobertura decide quais solicitações entram como atendimento contratado."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {filtrados.map((c) => (
                <li key={c.id}>
                  <LinhaDeContrato contrato={c} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A linha de um contrato.
 *
 * O que ela precisa dizer sem abrir: de quem é, até quando vale, se renova
 * sozinho, e se está para vencer. A versão anterior punha tudo numa frase
 * concatenada com pontos — legível uma vez, ilegível numa lista.
 *
 * A VIGÊNCIA VIRA BARRA, e é a informação que a frase escondia: "de 01/01 até
 * 31/12" exige que a pessoa faça a conta de quanto falta. A barra faz a conta.
 *
 * O AVISO DE VENCIMENTO diz quantos dias restam — e num contrato que renova
 * sozinho com aviso prévio, isso é o que impede a conversa tardia: faltando 45
 * dias numa janela de 60, a decisão já foi tomada por omissão, e dizer só
 * "vigente" esconde isso (§17).
 */
function LinhaDeContrato({ contrato: c }: { contrato: ContractRow }) {
  const inicio = new Date(c.starts_on).getTime();
  const fim = c.ends_on ? new Date(c.ends_on).getTime() : null;
  const agora = Date.now();

  const diasParaVencer = fim === null ? null : Math.round((fim - agora) / 86_400_000);
  const decorrido =
    fim === null || fim <= inicio ? null : Math.min(Math.max((agora - inicio) / (fim - inicio), 0), 1);

  const vencendo = diasParaVencer !== null && diasParaVencer >= 0 && diasParaVencer <= 90;
  const vencido = diasParaVencer !== null && diasParaVencer < 0;
  const larguraDaBarra = decorrido === null ? 0 : Math.round(decorrido * 100);

  return (
    <Link
      to="/contratos/$id"
      params={{ id: c.id }}
      className="flex flex-col gap-2.5 px-5 py-4 transition-colors hover:bg-surface-hover"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* Título nulo é permitido: há contrato identificado só pelo número,
              e mostrar "—" seria pior do que mostrar o número, que é o que a
              pessoa procura. */}
          <p className="truncate text-base font-semibold text-text">{c.title || c.number}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted" data-numeric>
            <span className="font-medium">{c.number}</span>
            {c.auto_renew && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <RefreshCw aria-hidden="true" className="size-3" />
                  renova sozinho
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {vencido && (
            <StatusChip tone="bad" size="sm">
              Vencido
            </StatusChip>
          )}
          {vencendo && (
            <StatusChip tone="warn" size="sm" hint="Prazo restante de vigência">
              Vence em {diasParaVencer} d
            </StatusChip>
          )}
          <StatusChip tone={TOM[c.status]} size="sm">
            {ROTULO[c.status]}
          </StatusChip>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-2xs text-subtle" data-numeric>
          {formatarData(c.starts_on)}
        </span>
        <span
          aria-hidden="true"
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-sunken"
        >
          {decorrido !== null && (
            <span
              className={cn(
                'block h-full rounded-pill',
                vencido ? 'bg-border-strong' : vencendo ? 'bg-warn' : 'bg-accent'
              )}
              style={{ width: `${larguraDaBarra}%` }}
            />
          )}
        </span>
        <span className="w-20 shrink-0 text-right text-2xs text-subtle" data-numeric>
          {c.ends_on ? formatarData(c.ends_on) : 'sem fim'}
        </span>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

interface Detalhe {
  contract: {
    id: string;
    number: string;
    title: string | null;
    status: ContractStatus;
    kind: string;
    starts_on: string;
    ends_on: string | null;
    auto_renew: boolean;
    renewal_notice_days: number | null;
    adjustment_index: string | null;
    billing_model: string;
    included_calls: number | null;
    included_hours: string | null;
    sla_target_percent: string | null;
    plan_target_percent: string | null;
    notes: string | null;
    monthly_value?: string | null;
    currency?: string | null;
    overage_call_rate?: string | null;
    overage_hour_rate?: string | null;
    penalty_percent_per_breach?: string | null;
    penalty_cap_percent?: string | null;
  };
  coverages: ContractCoverage[];
  services: Array<{ work_order_type_id: string; billed_separately: boolean }>;
}

export function ContratoPage() {
  const { id } = useParams({ strict: false }) as { id: string };

  const { data, isLoading, isError, error } = useApiQuery(contractDetail, { params: { id } }) as {
    data: Detalhe | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const { data: ativos, isLoading: carregandoAtivos } = useApiQuery(contractAssets, {
    params: { id },
  }) as {
    data: { items: Array<{ id: string; name: string; location_path: string | null }> } | undefined;
    isLoading: boolean;
  };

  if (isError) return <ErrorScreen error={error} />;

  if (isLoading || !data) {
    return (
      <AppShell title="Contrato">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  const c = data.contract;
  const valoresVisiveis = c.monthly_value != null;

  return (
    <AppShell
      title={c.title || c.number}
      subtitle={`${c.number} · ${ROTULO_MODELO[c.billing_model] ?? c.billing_model}`}
      breadcrumbs={[{ label: 'Contratos', href: '/contratos' }, { label: c.number }]}
    >
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={TOM[c.status]}>{ROTULO[c.status]}</StatusChip>
              {c.auto_renew && (
                <StatusChip tone="info" size="sm">
                  Renova sozinho
                  {c.renewal_notice_days ? ` · aviso de ${c.renewal_notice_days} dias` : ''}
                </StatusChip>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Info
                rotulo="Vigência"
                valor={`${formatarData(c.starts_on)} → ${c.ends_on ? formatarData(c.ends_on) : 'sem fim'}`}
              />
              <Info rotulo="Natureza" valor={c.kind} />
              <Info
                rotulo="Chamados inclusos"
                valor={c.included_calls === null ? null : String(c.included_calls)}
                vazio="Sem franquia"
              />
              <Info rotulo="Horas inclusas" valor={c.included_hours} vazio="Sem franquia" />
            </dl>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <Card>
              <CardHeader
                title="Cobertura"
                description="A expressão que define o escopo — não uma lista marcada a mão."
              />
              <div className="p-2">
                {data.coverages.length === 0 ? (
                  <EmptyState
                    icon={<ShieldCheck className="size-5" />}
                    title="Sem cobertura definida"
                    description="Um contrato sem cobertura não protege equipamento nenhum."
                    className="py-6"
                  />
                ) : (
                  <ul>
                    {data.coverages.map((cv, i) => (
                      <li
                        key={cv.id}
                        className={cn(
                          'flex items-baseline gap-3 px-2.5 py-2 text-sm',
                          i > 0 && 'border-t border-border-subtle'
                        )}
                      >
                        <span className="min-w-0 flex-1 text-text">
                          {ROTULO_COBERTURA[cv.kind] ?? cv.kind}
                        </span>
                        {/*
                         * A especificidade é o desempate quando duas coberturas
                         * alcançam o mesmo equipamento: vence quem nomeia mais
                         * de perto. Mostrá-la é o que permite entender por que
                         * um ativo caiu num contrato e não no outro.
                         */}
                        <span
                          className="shrink-0 text-xs text-muted tabular-nums"
                          data-numeric
                          title="Quanto maior, mais de perto esta cobertura nomeia o ativo — é o desempate entre contratos"
                        >
                          especificidade {cv.specificity}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Ativos cobertos hoje"
                description="A expressão resolvida contra o parque de agora. Amanhã pode ser outra lista."
                actions={
                  ativos && (
                    <span className="text-sm font-semibold text-text tabular-nums" data-numeric>
                      {ativos.items.length}
                    </span>
                  )
                }
              />
              <div className="max-h-80 overflow-y-auto p-2">
                {carregandoAtivos ? (
                  <SkeletonList rows={5} label="ativos cobertos" />
                ) : !ativos || ativos.items.length === 0 ? (
                  <EmptyState
                    icon={<Boxes className="size-5" />}
                    title="A cobertura não alcança nenhum ativo hoje"
                    description="Isso pode ser correto — a expressão pode valer para equipamentos que ainda vão chegar."
                    className="py-6"
                  />
                ) : (
                  <ul>
                    {ativos.items.map((a, i) => (
                      <li key={a.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                        <Link
                          to="/ativos/$id"
                          params={{ id: a.id }}
                          className="block px-2.5 py-2 transition-colors hover:bg-surface-hover"
                        >
                          <span className="block truncate text-sm text-text">{a.name}</span>
                          {a.location_path && (
                            <span className="block truncate text-xs text-muted">{a.location_path}</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            {valoresVisiveis && (
              <Card>
                <CardHeader title="Valores" description="Visível para quem tem permissão financeira." />
                <dl className="flex flex-col gap-3 p-4 text-sm">
                  <Info rotulo="Mensal" valor={moeda(c.monthly_value, c.currency)} />
                  <Info
                    rotulo="Excedente por chamado"
                    valor={moeda(c.overage_call_rate, c.currency)}
                    vazio="Não cobrado"
                  />
                  <Info
                    rotulo="Excedente por hora"
                    valor={moeda(c.overage_hour_rate, c.currency)}
                    vazio="Não cobrado"
                  />
                  {/*
                   * GLOSA SEM PERCENTUAL CONFIGURADO É NULA, e não zero.
                   *
                   * A auditoria não confirmou nenhuma regra de glosa na
                   * referência, e inventar uma escreveria no sistema uma
                   * cláusula que não está em contrato nenhum. Sem o percentual,
                   * a medição mostra os SLA violados sem atribuir valor a eles.
                   */}
                  <Info
                    rotulo="Glosa por violação"
                    valor={c.penalty_percent_per_breach ? `${c.penalty_percent_per_breach}%` : null}
                    vazio="Não configurada — a medição mostra as violações sem valorá-las"
                  />
                  <Info
                    rotulo="Teto de glosa"
                    valor={c.penalty_cap_percent ? `${c.penalty_cap_percent}%` : null}
                    vazio="Sem teto"
                  />
                </dl>
              </Card>
            )}

            <Card>
              <CardHeader title="Metas" />
              <dl className="flex flex-col gap-3 p-4 text-sm">
                <Info
                  rotulo="Cumprimento de SLA"
                  valor={c.sla_target_percent ? `${c.sla_target_percent}%` : null}
                  vazio="Sem meta acordada"
                />
                <Info
                  rotulo="Cumprimento do plano"
                  valor={c.plan_target_percent ? `${c.plan_target_percent}%` : null}
                  vazio="Sem meta acordada"
                />
                <Info rotulo="Índice de reajuste" valor={c.adjustment_index} vazio="Sem reajuste" />
              </dl>
            </Card>

            {c.notes && (
              <Card>
                <CardHeader title="Observações" />
                <p className="p-4 text-sm whitespace-pre-wrap text-text">{c.notes}</p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

const ROTULO_MODELO: Record<string, string> = {
  fixed_monthly: 'Mensalidade fixa',
  per_call: 'Por chamado',
  per_hour: 'Por hora',
  hybrid: 'Misto',
};

const ROTULO_COBERTURA: Record<string, string> = {
  customer: 'Todos os equipamentos do cliente',
  // O nome no banco é `location_subtree`, e o `subtree` é a parte que importa:
  // a cobertura alcança o que está DENTRO do local, e não só o que está
  // exatamente nele. Chamá-la de "local" na tela apagaria justamente a
  // propriedade que faz a expressão valer para o equipamento que chegar amanhã.
  location_subtree: 'O local e tudo que está dentro dele',
  asset_category: 'Todos os equipamentos de uma categoria',
  asset: 'Um equipamento específico',
};

function Info({
  rotulo,
  valor,
  vazio,
}: {
  rotulo: string;
  valor: string | null | undefined;
  vazio?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-subtle">{rotulo}</dt>
      <dd className="mt-0.5 text-sm text-text">
        {valor || <span className="text-subtle">{vazio ?? '—'}</span>}
      </dd>
    </div>
  );
}

/**
 * `numeric` em texto vira moeda.
 *
 * `Number()` só na formatação: converter na entrada introduziria erro de ponto
 * flutuante em dinheiro, que é o defeito que faz um relatório fechar com três
 * centavos de diferença que ninguém acha de onde vieram.
 */
function moeda(valor: string | null | undefined, currency: string | null | undefined): string | null {
  if (valor == null) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: currency?.trim() || 'BRL' });
}
