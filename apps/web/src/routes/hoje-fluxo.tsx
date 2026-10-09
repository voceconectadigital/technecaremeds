/**
 * Aurora — o fluxo da operação, numa faixa só.
 *
 * A pergunta que quem chega pela primeira vez faz é "de onde vem o trabalho?".
 * Esta faixa responde e, ao mesmo tempo, mostra o estado agora: cada etapa é
 * um número ao vivo e um atalho para a tela onde aquela etapa é tratada.
 *
 *   Solicitação → Triagem → OS aberta → Agendada → Em execução → Concluída
 *
 * Toda ordem de serviço nasce de uma solicitação ACEITA na triagem (ou de um
 * plano preventivo) — dizer isso aqui evita que alguém procure um botão
 * "Nova OS" que, por desenho, não é o caminho principal.
 *
 * Os números vêm das mesmas rotas que a tela já consulta (quadro e fila);
 * nenhuma ida extra ao servidor só para enfeitar.
 */
import { Link } from '@tanstack/react-router';
import { ArrowRight, CalendarCheck2, CheckCircle2, ClipboardList, Inbox, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@aurora/ui';
import { requestsQueue, workOrdersBoard } from '@aurora/contracts';
import { useApiQuery, usePermissions } from '@aurora/app-kit';

/** O mesmo recorte do bloco de triagem: mesma consulta, mesmo cache. */
const LIMITE_FILA = 6;

interface Coluna {
  category: string;
  total: number;
}

interface Etapa {
  chave: string;
  titulo: string;
  descricao: string;
  valor: number | string | null;
  icone: ReactNode;
  to: string;
  destaque?: 'warn' | 'good' | 'accent';
}

export function FluxoDaOperacao() {
  const { can } = usePermissions();
  const { data: quadro } = useApiQuery(workOrdersBoard) as { data: { columns: Coluna[] } | undefined };
  const { data: fila } = useApiQuery(requestsQueue, { query: { limit: LIMITE_FILA } }) as {
    data: { items: unknown[] } | undefined;
  };

  const colunas = quadro?.columns ?? [];
  const soma = (...cats: string[]) =>
    quadro ? colunas.filter((c) => cats.includes(c.category)).reduce((s, c) => s + c.total, 0) : null;
  const triagem = fila ? fila.items.length : null;
  const triagemRotulo = triagem === null ? null : triagem >= LIMITE_FILA ? `${LIMITE_FILA}+` : triagem;

  const etapas: Etapa[] = [
    {
      chave: 'triagem',
      titulo: 'Solicitações',
      descricao: 'Pedidos aguardando triagem',
      valor: can('service_request.read') ? triagemRotulo : null,
      icone: <Inbox className="size-4" />,
      to: '/solicitacoes',
      destaque: triagem ? 'warn' : undefined,
    },
    {
      chave: 'abertas',
      titulo: 'OS abertas',
      descricao: 'Aceitas, ainda sem data',
      valor: soma('open', 'draft'),
      icone: <ClipboardList className="size-4" />,
      to: '/ordens',
    },
    {
      chave: 'agendadas',
      titulo: 'Agendadas',
      descricao: 'Com técnico e horário',
      valor: soma('scheduled'),
      icone: <CalendarCheck2 className="size-4" />,
      to: '/agenda',
    },
    {
      chave: 'execucao',
      titulo: 'Em execução',
      descricao: 'Em campo agora (ou aguardando)',
      valor: soma('in_progress', 'waiting', 'paused'),
      icone: <Wrench className="size-4" />,
      to: '/ordens',
      destaque: 'accent',
    },
    {
      chave: 'concluidas',
      titulo: 'Concluídas',
      descricao: 'Resolvidas e registradas',
      valor: soma('done', 'closed', 'review'),
      icone: <CheckCircle2 className="size-4" />,
      to: '/indicadores',
      destaque: 'good',
    },
  ];

  return (
    <section
      aria-labelledby="fluxo-da-operacao"
      className="relative overflow-hidden rounded-card border border-border bg-surface p-5 shadow-card"
    >
      {/* Trama sutil de painel: textura, não ruído — some nos temas claros. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        style={{
          backgroundImage:
            'linear-gradient(var(--aurora-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--aurora-border-subtle) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      <div className="relative mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="fluxo-da-operacao" className="text-lg font-semibold text-text">
            Fluxo da operação
          </h2>
          <p className="text-sm text-muted">
            Toda ordem de serviço nasce de uma{' '}
            <strong className="font-semibold text-text">solicitação aceita</strong> na triagem — ou de um
            plano preventivo.
          </p>
        </div>
        <Link
          to="/solicitacoes/nova"
          className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface-raised px-3 py-1.5 text-sm font-medium text-accent-text transition-colors hover:border-accent hover:shadow-glow"
        >
          Abrir solicitação <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <ol className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {etapas.map((e, i) => (
          <li key={e.chave} className="relative">
            <Link
              to={e.to}
              className={cn(
                'group flex h-full flex-col gap-2 rounded-control border border-border-subtle bg-surface-subtle/70 p-3.5',
                'transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-hover motion-reduce:transform-none'
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-8 place-items-center rounded-pill border',
                    e.destaque === 'warn' && 'border-warn/40 bg-warn-soft text-warn-text',
                    e.destaque === 'good' && 'border-good/40 bg-good-soft text-good-text',
                    e.destaque === 'accent' && 'border-accent/40 bg-accent-soft text-accent-text',
                    !e.destaque && 'border-border bg-surface text-muted'
                  )}
                >
                  {e.icone}
                </span>
                <span className="text-2xs font-semibold tracking-[0.14em] text-subtle">0{i + 1}</span>
              </div>
              <span
                data-display
                data-numeric
                className="text-3xl leading-none font-semibold text-text tabular-nums"
              >
                {e.valor ?? '—'}
              </span>
              <span>
                <span className="block text-sm font-semibold text-text">{e.titulo}</span>
                <span className="block text-xs text-muted">{e.descricao}</span>
              </span>
            </Link>
            {i < etapas.length - 1 && (
              <ArrowRight
                aria-hidden="true"
                className="absolute top-1/2 -right-[13px] z-10 hidden size-4 -translate-y-1/2 text-subtle lg:block"
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
