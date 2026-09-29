/**
 * Aurora — "Hoje" (SPEC v0.2 §34, §40).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A TELA INICIAL NÃO É UM PAINEL DE INDICADORES — E TAMBÉM NÃO É UMA TELA VAZIA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A regra original continua valendo: quem abre a Aurora às sete da manhã não
 * quer o MTTR do trimestre; quer saber o que precisa dela AGORA. Indicador de
 * análise tem tela própria.
 *
 * O que a versão anterior errou foi confundir "não é painel analítico" com "dois
 * cartões e muito espaço em branco". A pergunta "como está a operação hoje?"
 * TEM resposta numérica, e ela é operacional: quantas ordens abertas, quantas
 * com prazo estourando, o que está parado e por quê, o que está sem data, o que
 * vai faltar no almoxarifado. Isso não é análise — é o estado do turno.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRÊS REGRAS QUE ORGANIZAM ESTA TELA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. TODO NÚMERO LEVA A ALGUM LUGAR. Um cartão que informa e não permite agir
 *    obriga a pessoa a reconstruir o filtro na mão na tela seguinte — e ela
 *    reconstrói errado. Cada bloco aqui aponta para a lista já filtrada.
 *
 * 2. NADA É INVENTADO. Todos os números saem de rotas que já existem. Onde a
 *    API ainda não responde (tendência histórica, por exemplo), a tela não
 *    desenha uma seta bonita: ela omite. Um indicador decorativo num painel
 *    operacional é pior que um espaço vazio.
 *
 * 3. O VAZIO TAMBÉM É RESPOSTA. "Nada aguardando triagem" é uma boa notícia e
 *    ocupa o mesmo espaço da lista cheia, porque a tela não pode encolher e
 *    crescer conforme o dia — a pessoa perde a referência de onde as coisas
 *    ficam.
 */
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Inbox,
  PackageSearch,
  PauseCircle,
  Timer,
  Wrench,
} from 'lucide-react';
import {
  BarChart,
  Card,
  CardHeader,
  DonutChart,
  EmptyState,
  Metric,
  MetricGrid,
  Section,
  SkeletonList,
  StatusChip,
  Thumb,
  cn,
} from '@aurora/ui';
import {
  inventoryBalances,
  requestsQueue,
  scheduleBuckets,
  workOrdersBoard,
  type AgendaBucketItem,
  type BoardColumn,
  type ServiceRequestRow,
  type StockBalance,
} from '@aurora/contracts';
import { useApiQuery, usePermissions, useSessionQuery } from '@aurora/app-kit';
import { AppShell } from '../shell/app-shell';

export function HojePage() {
  const { data: sessao } = useSessionQuery();
  const { can } = usePermissions();

  const primeiroNome = (sessao?.user.name ?? '').split(/\s+/)[0];

  return (
    <AppShell
      title={primeiroNome ? `${saudacao()}, ${primeiroNome}` : 'Hoje'}
      subtitle="O estado da operação agora, e o que precisa de você."
      actions={<DataDeHoje />}
    >
      <div className="flex flex-col gap-8">
        {can('work_order.read') && <PainelDoTurno />}

        <div className="grid gap-5 lg:grid-cols-3">
          {can('service_request.read') && <BlocoTriagem className="lg:col-span-1" />}
          {can('work_order.read') && <BlocoQuadro className="lg:col-span-2" />}
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {can('work_order.read') && <BlocoAgenda className="lg:col-span-2" />}
          {can('work_order.read') && <BlocoParadas className="lg:col-span-1" />}
        </div>

        {can('inventory.read') && <BlocoEstoque />}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* a faixa de indicadores do turno                                            */
/* -------------------------------------------------------------------------- */

/**
 * Cinco números, e cada um responde uma pergunta que alguém faz em voz alta.
 *
 * Eles vêm de duas rotas que a tela já ia chamar de qualquer forma (o quadro e
 * os baldes da agenda), então a faixa não custa nenhuma ida extra ao servidor —
 * o que importa numa tela que abre a cada troca de aba.
 */
function PainelDoTurno() {
  const { data: quadro, isLoading: carregandoQuadro } = useApiQuery(workOrdersBoard) as {
    data: { columns: BoardColumn[] } | undefined;
    isLoading: boolean;
  };
  const { data: baldes } = useApiQuery(scheduleBuckets) as {
    data: { counts: Record<string, number>; items: AgendaBucketItem[] } | undefined;
  };
  const { data: faltando } = useApiQuery(inventoryBalances, { query: { below_minimum: 'true' } }) as {
    data: { items: StockBalance[] } | undefined;
  };

  const colunas = quadro?.columns ?? [];
  const porCategoria = (c: string) =>
    colunas.filter((x) => x.category === c).reduce((s, x) => s + x.total, 0);

  const abertas = porCategoria('open') + porCategoria('scheduled') + porCategoria('in_progress');
  const emExecucao = porCategoria('in_progress');
  const paradas = porCategoria('waiting') + porCategoria('paused');
  const atrasadas = baldes?.counts.late ?? 0;
  const semData = baldes?.counts.unscheduled ?? 0;
  const abaixoDoMinimo = faltando?.items.length ?? 0;

  if (carregandoQuadro) {
    return (
      <MetricGrid columns={4}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-card border border-border bg-surface" />
        ))}
      </MetricGrid>
    );
  }

  return (
    <MetricGrid columns={4}>
      <Metric
        label="Em aberto"
        value={abertas}
        hint={emExecucao > 0 ? `${emExecucao} em execução agora` : 'Nenhuma em execução'}
        icon={<ClipboardList className="size-4" />}
        tone={abertas === 0 ? 'good' : 'neutral'}
        action={<AtalhoDeCartao to="/ordens">Abrir o quadro</AtalhoDeCartao>}
      />
      <Metric
        label="Atrasadas"
        value={atrasadas}
        hint={atrasadas === 0 ? 'Nenhuma janela vencida' : 'Janela de agendamento já venceu'}
        icon={<Timer className="size-4" />}
        // O tom é uma decisão de produto: zero atrasada é notícia boa e merece
        // o verde; qualquer número acima disso é vermelho, sem escala
        // intermediária. "Três atrasadas" não é menos urgente que "oito" —
        // as três já estouraram.
        tone={atrasadas > 0 ? 'bad' : 'good'}
        action={<AtalhoDeCartao to="/agenda">Ver agenda</AtalhoDeCartao>}
      />
      <Metric
        label="Paradas"
        value={paradas}
        hint={paradas === 0 ? 'Nada travado' : 'Aguardando peça, terceiro ou cliente'}
        icon={<PauseCircle className="size-4" />}
        tone={paradas > 0 ? 'warn' : 'good'}
        action={<AtalhoDeCartao to="/ordens">Ver o que travou</AtalhoDeCartao>}
      />
      <Metric
        label="Sem data"
        value={semData}
        hint={semData === 0 ? 'Tudo programado' : 'Ordens que ninguém agendou ainda'}
        icon={<CalendarClock className="size-4" />}
        tone={semData > 0 ? 'warn' : 'good'}
        action={<AtalhoDeCartao to="/agenda">Programar</AtalhoDeCartao>}
      />
      {abaixoDoMinimo > 0 && (
        <Metric
          className="sm:col-span-2 lg:col-span-4"
          label="Peças abaixo do mínimo"
          value={abaixoDoMinimo}
          hint="Comprar antes de faltar — falta de peça é a maior causa de OS travada."
          icon={<PackageSearch className="size-4" />}
          tone="warn"
          action={<AtalhoDeCartao to="/estoque">Ver o que comprar</AtalhoDeCartao>}
        />
      )}
    </MetricGrid>
  );
}

function AtalhoDeCartao({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      /* `min-h-6`: a auditoria de largura exige alvo de toque de ao menos
         24×24 no celular (WCAG 2.2, 2.5.8). Um link de texto tem a altura da
         linha, que fica abaixo disso — e este atalho é como o cartão inteiro
         se torna acionável no polegar. */
      className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-accent-text hover:underline"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

function BlocoTriagem({ className }: { className?: string }) {
  const { data, isLoading } = useApiQuery(requestsQueue, { query: { limit: 6 } }) as {
    data: { items: ServiceRequestRow[] } | undefined;
    isLoading: boolean;
  };

  const itens = data?.items ?? [];

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title="Aguardando triagem"
        description="Pedidos que ainda não viraram trabalho."
        actions={<VerTudo to="/solicitacoes">Ver fila</VerTudo>}
      />
      <div className="min-h-0 flex-1 p-3">
        {isLoading ? (
          <SkeletonList rows={4} label="solicitações" />
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" />}
            title="Nada aguardando triagem"
            description="Toda solicitação enviada já foi decidida."
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {itens.map((r) => (
              <li key={r.id}>
                <Link
                  to="/solicitacoes/$id"
                  params={{ id: r.id }}
                  className="flex items-start gap-3 rounded-control px-2.5 py-2.5 transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-text">{r.summary}</span>
                    <span className="mt-0.5 block text-xs text-muted" data-numeric>
                      {r.number} · {formatarDataRelativa(r.created_at)}
                    </span>
                  </span>
                  <PrioridadeChip prioridade={r.priority} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A distribuição do trabalho, em rosca.
 *
 * É a única pergunta do painel que é de COMPOSIÇÃO — "deste total, quanto está
 * em cada fase?" —, e é para isso que a rosca serve. O total vai no buraco do
 * meio, que é o melhor lugar da tela para ele.
 */
function BlocoQuadro({ className }: { className?: string }) {
  const { data, isLoading } = useApiQuery(workOrdersBoard) as {
    data: { columns: BoardColumn[] } | undefined;
    isLoading: boolean;
  };

  const colunas = (data?.columns ?? []).filter((c) => c.total > 0);
  const total = colunas.reduce((s, c) => s + c.total, 0);

  const TOM_POR_CATEGORIA: Record<string, 'good' | 'warn' | 'bad' | 'info' | 'accent' | 'neutral'> = {
    draft: 'neutral',
    open: 'info',
    scheduled: 'accent',
    in_progress: 'accent',
    waiting: 'warn',
    paused: 'warn',
    review: 'info',
    done: 'good',
    closed: 'good',
    cancelled: 'neutral',
  };

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title="Onde o trabalho está"
        description="Cada ordem de serviço em aberto, por situação."
        actions={<VerTudo to="/ordens">Ver quadro</VerTudo>}
      />
      <div className="flex min-h-0 flex-1 items-center p-4">
        {isLoading ? (
          <SkeletonList rows={4} label="ordens de serviço" className="w-full" />
        ) : total === 0 ? (
          <EmptyState
            className="w-full"
            icon={<Wrench className="size-5" />}
            title="Nenhuma ordem em aberto"
            description="Quando uma solicitação for aceita, ela aparece aqui."
          />
        ) : (
          <DonutChart
            className="w-full"
            label="Ordens de serviço por situação"
            centerValue={total}
            centerLabel={total === 1 ? 'ordem' : 'ordens'}
            data={colunas.map((c) => ({
              label: c.label,
              value: c.total,
              tone: TOM_POR_CATEGORIA[c.category] ?? 'neutral',
            }))}
          />
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A agenda do dia, e o que escapou dela.
 *
 * Mostra hoje e atrasadas juntas, nessa ordem, porque é assim que a coordenação
 * decide: o atrasado entra no dia de alguém: ele não espera um segundo momento.
 */
function BlocoAgenda({ className }: { className?: string }) {
  const { data, isLoading } = useApiQuery(scheduleBuckets) as {
    data: { counts: Record<string, number>; items: AgendaBucketItem[] } | undefined;
    isLoading: boolean;
  };

  const itens = data?.items ?? [];
  /*
   * A ORDEM É A DA URGÊNCIA: o que já venceu, depois o que precisa ser
   * remarcado, depois o que nunca teve data. É a mesma ordem do §13, e é como
   * a coordenação decide — o atrasado entra no dia de alguém hoje, não espera
   * um segundo momento.
   */
  const atrasadas = itens.filter((i) => i.bucket === 'late');
  const remarcar = itens.filter((i) => i.bucket === 'to_reschedule');
  const semData = itens.filter((i) => i.bucket === 'unscheduled');
  const mostrar = [...atrasadas, ...remarcar, ...semData].slice(0, 6);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title="Precisa de data"
        description="O que venceu, o que precisa remarcar e o que ninguém programou."
        actions={<VerTudo to="/agenda">Ver agenda</VerTudo>}
      />
      <div className="min-h-0 flex-1 p-3">
        {isLoading ? (
          <SkeletonList rows={4} label="agenda" />
        ) : mostrar.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-5" />}
            title="A programação está em dia"
            description="Nenhuma ordem vencida, para remarcar ou sem data."
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {mostrar.map((i) => (
              <li key={i.work_order_id}>
                <Link
                  to="/ordens/$id"
                  params={{ id: i.work_order_id }}
                  className="flex items-center gap-3 rounded-control px-2.5 py-2.5 transition-colors hover:bg-surface-hover"
                >
                  <span className="w-14 shrink-0 text-sm font-semibold tabular-nums text-text" data-numeric>
                    {i.scheduled_start ? horaDe(i.scheduled_start) : '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-text">{i.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {[i.number, i.assignee_name ?? 'sem responsável', i.location_name]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {i.bucket === 'late' && (
                    <StatusChip tone="bad" size="sm">
                      Atrasada
                    </StatusChip>
                  )}
                  {i.bucket === 'to_reschedule' && (
                    <StatusChip tone="warn" size="sm" hint={i.window_invalidated_reason ?? undefined}>
                      Reagendar
                    </StatusChip>
                  )}
                  {/* Remarcar quatro vezes não é um item comum do balde: é um
                      caso que a coordenação precisa ver. */}
                  {i.reschedule_count >= 3 && (
                    <StatusChip tone="warn" size="sm" hint={`Remarcada ${i.reschedule_count} vezes`}>
                      {i.reschedule_count}× remarcada
                    </StatusChip>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O bloco de OS paradas.
 *
 * Mostra o MOTIVO, e não só a contagem: "sete paradas" não é diagnóstico;
 * "cinco esperando peça, duas esperando o cliente" diz o que fazer. É a
 * pergunta que o §09 destravou e que a referência não respondia.
 */
function BlocoParadas({ className }: { className?: string }) {
  const { data, isLoading } = useApiQuery(workOrdersBoard) as {
    data: { columns: BoardColumn[] } | undefined;
    isLoading: boolean;
  };

  const esperando = (data?.columns ?? []).filter((c) => c.category === 'waiting' && c.total > 0);
  const motivos = esperando.flatMap((c) => c.by_wait_reason);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader title="Paradas, e por quê" description="Onde o trabalho está travado agora." />
      <div className="min-h-0 flex-1 p-4">
        {isLoading ? (
          <SkeletonList rows={3} label="motivos de espera" />
        ) : motivos.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="Nada parado"
            description="Nenhuma ordem aguardando terceiro, peça ou cliente."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <BarChart
              label="Ordens paradas por motivo de espera"
              data={motivos.map((m) => ({
                label: m.label,
                value: m.total,
                // Relógio correndo é pior que relógio pausado: parar por peça
                // do fabricante não conta contra o SLA; parar por falta de
                // técnico conta.
                tone: m.pauses_sla ? 'neutral' : 'bad',
              }))}
            />
            <p className="text-xs text-muted">
              Em vermelho, o que continua consumindo prazo de SLA enquanto espera.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O que vai faltar.
 *
 * Falta de peça foi a maior causa de OS travada na referência auditada — 789
 * registros de "aguardando peça". Por isso o estoque aparece no painel do
 * turno, e não só no módulo próprio: quem compra precisa ver antes de faltar.
 */
function BlocoEstoque() {
  const { data, isLoading } = useApiQuery(inventoryBalances, { query: { below_minimum: 'true' } }) as {
    data: { items: StockBalance[] } | undefined;
    isLoading: boolean;
  };

  const itens = data?.items ?? [];
  if (!isLoading && itens.length === 0) return null;

  return (
    <Section
      title="Comprar antes de faltar"
      description="Itens abaixo do mínimo definido para o almoxarifado."
      actions={<VerTudo to="/estoque">Ver estoque</VerTudo>}
    >
      {isLoading ? (
        <SkeletonList rows={2} label="itens de estoque" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {itens.slice(0, 6).map((b) => (
            <li key={`${b.item_id}-${b.warehouse_id}`}>
              <Card className="flex items-center gap-3 p-3">
                <Thumb src={b.image_url} name={b.item_name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-text">{b.item_name}</p>
                  <p className="truncate text-xs text-muted" data-numeric>
                    {b.sku} · {b.warehouse_name}
                  </p>
                  <p className="mt-1 flex items-baseline gap-1 text-sm">
                    <span className="font-semibold tabular-nums text-bad-text" data-numeric>
                      {b.available}
                    </span>
                    <span className="text-muted">disponível · mínimo {b.min_qty}</span>
                  </p>
                </div>
                <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-warn" />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* peças pequenas                                                             */
/* -------------------------------------------------------------------------- */

function VerTudo({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="-mx-1 flex min-h-6 items-center gap-1 rounded-control px-1 text-sm font-medium text-accent-text hover:underline"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

function DataDeHoje() {
  const hoje = new Date();
  return (
    <span className="text-base text-muted first-letter:uppercase">
      {hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
    </span>
  );
}

/** Saudação pela hora do relógio de quem abre — não do servidor. */
function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function horaDe(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* -------------------------------------------------------------------------- */

/*
 * A ESCALA É A DA SOLICITAÇÃO, e não uma tradução.
 *
 * Este mapa dizia `critical`, `high` e `normal` — três valores que o banco não
 * grava. O tipo do PostgreSQL é `request_priority`: none, low, urgent,
 * very_urgent, emergency. O efeito na tela era mudo e feio: toda OS urgente
 * procurava `TOM_PRIORIDADE['urgent']`, não achava, e renderizava um chip sem
 * tom e sem rótulo — um retângulo vazio ao lado do título.
 */
const TOM_PRIORIDADE = {
  emergency: 'bad',
  very_urgent: 'bad',
  urgent: 'warn',
  low: 'neutral',
  none: 'neutral',
} as const;

const ROTULO_PRIORIDADE = {
  emergency: 'Emergência',
  very_urgent: 'Muito urgente',
  urgent: 'Urgente',
  low: 'Baixa',
  none: 'Sem prioridade',
} as const;

export function PrioridadeChip({ prioridade }: { prioridade: keyof typeof TOM_PRIORIDADE }) {
  // Sem urgência declarada não vira chip: um chip cinza em toda linha é ruído
  // que esconde os que importam. "Baixa" também não — dizer "esta é menos
  // importante" em cada linha não muda a decisão de ninguém.
  if (prioridade === 'none' || prioridade === 'low') return null;
  return (
    <StatusChip tone={TOM_PRIORIDADE[prioridade]} size="sm">
      {ROTULO_PRIORIDADE[prioridade]}
    </StatusChip>
  );
}

/**
 * "há 3 dias", e não "27/08/2026 14:32".
 *
 * Numa fila de triagem, a idade é a informação; a data exata não é. Quem
 * precisar do instante encontra na ficha.
 */
export function formatarDataRelativa(iso: string): string {
  const quando = new Date(iso).getTime();
  const minutos = Math.round((Date.now() - quando) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 30) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export { cn };
