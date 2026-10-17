/**
 * Aurora — meus equipamentos, documentos e orçamentos (SPEC v0.2 §19).
 *
 * TRÊS TELAS NUM ARQUIVO porque as três respondem à mesma pergunta de fundo:
 * "o que é meu, e está em ordem?".
 *
 * NENHUM VALOR FINANCEIRO APARECE NO EQUIPAMENTO.
 *
 * Não porque a tela esconde: porque o servidor não manda. Compra, residual e
 * reposição são a contabilidade do parque, e quando ela é do cliente, o número
 * que vale é o dele — e não o nosso.
 *
 * DOCUMENTO SÓ APARECE DEPOIS DE LIBERADO. Entre emitido e liberado há a
 * conferência interna; mostrar o emitido antecipa uma conversa que a equipe
 * ainda não teve — e, quando o parecer é "não conforme", antecipa a pior.
 */
import { BadgeCheck, FileCheck2, Receipt, Wrench } from 'lucide-react';
import { Card, EmptyState, SkeletonList, StatusChip, cn } from '@aurora/ui';
import { useApiQuery } from '@aurora/app-kit';
import {
  portalAssets,
  portalDocuments,
  portalQuotes,
  type PortalAsset,
  type PortalDocument,
  type PortalQuote,
} from '@aurora/contracts';
import { Casca } from '../casca';
import { data as formatarData, quando, reais } from '../formato';
import { BaixarDocumento, DecisaoDoOrcamento } from './decisoes';
import { FalhaDeCarga } from './falha-de-carga';

export function EquipamentosPage() {
  const { data, isLoading, isError, refetch } = useApiQuery(portalAssets) as {
    data: { items: PortalAsset[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => unknown;
  };

  const itens = data?.items ?? [];

  return (
    <Casca titulo="Meus equipamentos" subtitulo="O que está sob contrato, e quando é a próxima visita.">
      <Card>
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={6} label="equipamentos" />
          </div>
        ) : isError ? (
          <FalhaDeCarga onTentar={() => void refetch()} />
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<Wrench className="size-5" />}
            title="Nenhum equipamento no seu setor"
            description="Se você deveria ver equipamentos aqui, fale com quem administra o contrato."
          />
        ) : (
          <ul>
            {itens.map((a, i) => (
              <li
                key={a.id}
                className={cn(
                  'flex min-h-14 items-center gap-3 px-4 py-3',
                  i > 0 && 'border-t border-border-subtle'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base text-text">{a.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted" data-numeric>
                    {[a.tag, a.category_name, a.location_name].filter(Boolean).join(' · ')}
                  </span>
                </span>

                {a.next_service_at && (
                  <span className="hidden shrink-0 text-right sm:block">
                    <span className="block text-2xs text-subtle">próxima visita</span>
                    <span className="block text-xs text-muted" data-numeric>
                      {quando(a.next_service_at)}
                    </span>
                  </span>
                )}

                {a.warranty_until && (
                  <StatusChip tone="info" size="sm" hint={`Garantia até ${formatarData(a.warranty_until)}`}>
                    <BadgeCheck aria-hidden="true" className="mr-1 inline size-3" />
                    garantia
                  </StatusChip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Casca>
  );
}

/* -------------------------------------------------------------------------- */

export function DocumentosPage() {
  const { data, isLoading, isError, refetch } = useApiQuery(portalDocuments) as {
    data: { items: PortalDocument[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => unknown;
  };

  const itens = data?.items ?? [];

  return (
    <Casca titulo="Documentos" subtitulo="Laudos e certificados liberados para você.">
      <Card>
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={5} label="documentos" />
          </div>
        ) : isError ? (
          <FalhaDeCarga onTentar={() => void refetch()} />
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<FileCheck2 className="size-5" />}
            title="Nenhum documento liberado"
            description="Laudos aparecem aqui depois de emitidos e conferidos pela equipe técnica."
          />
        ) : (
          <ul>
            {itens.map((d, i) => (
              <li
                key={d.id}
                className={cn(
                  'flex min-h-14 items-center gap-3 px-4 py-3',
                  i > 0 && 'border-t border-border-subtle'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base text-text">{d.title || d.type_name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted" data-numeric>
                    {[d.number, d.asset_name].filter(Boolean).join(' · ')}
                  </span>
                </span>

                {d.valid_until && (
                  <span className="shrink-0 text-xs text-muted" data-numeric>
                    até {formatarData(d.valid_until)}
                  </span>
                )}

                {d.verdict && (
                  <StatusChip tone={tomDoVeredito(d.verdict)} size="sm">
                    {ROTULO_VEREDITO[d.verdict] ?? d.verdict}
                  </StatusChip>
                )}

                <BaixarDocumento doc={d} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Casca>
  );
}

/* -------------------------------------------------------------------------- */

export function OrcamentosPage() {
  const { data, isLoading, isError, refetch } = useApiQuery(portalQuotes) as {
    data: { items: PortalQuote[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => unknown;
  };

  const itens = data?.items ?? [];
  const aguardando = itens.filter((q) => q.awaiting_decision);

  return (
    <Casca titulo="Orçamentos" subtitulo="O que foi proposto, e o que espera sua decisão.">
      <div className="flex flex-col gap-4">
        {aguardando.length > 0 && (
          /*
           * O QUE ESPERA DECISÃO VEM PRIMEIRO, e separado.
           *
           * Um orçamento pendente no meio de dez fechados é um orçamento que
           * fica lá duas semanas — e a ordem de serviço parada junto.
           */
          <Card className="border-warn/40">
            <ul>
              {aguardando.map((q, i) => (
                <li
                  key={q.id}
                  className={cn(
                    'flex min-h-14 flex-wrap items-center gap-3 bg-warn-soft px-4 py-3',
                    i > 0 && 'border-t border-border-subtle'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-warn-text" data-numeric>
                      {q.number}
                    </span>
                    <span className="block text-xs text-warn-text/80">
                      {q.valid_until ? `Vale até ${formatarData(q.valid_until)}` : 'Aguardando sua decisão'}
                    </span>
                  </span>
                  <span className="shrink-0 text-base font-semibold text-warn-text tabular-nums" data-numeric>
                    {reais(q.total_cents)}
                  </span>
                  <DecisaoDoOrcamento quote={q} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          {isLoading ? (
            <div className="p-3">
              <SkeletonList rows={4} label="orçamentos" />
            </div>
          ) : isError ? (
            <FalhaDeCarga onTentar={() => void refetch()} />
          ) : itens.length === 0 ? (
            <EmptyState
              icon={<Receipt className="size-5" />}
              title="Nenhum orçamento"
              description="Quando um atendimento exigir aprovação de custo, o orçamento aparece aqui."
            />
          ) : (
            <ul>
              {itens.map((q, i) => (
                <li
                  key={q.id}
                  className={cn(
                    'flex min-h-14 items-center gap-3 px-4 py-3',
                    i > 0 && 'border-t border-border-subtle'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-text" data-numeric>
                      {q.number}
                      {q.version > 1 && <span className="ml-1 text-xs text-muted">v{q.version}</span>}
                    </span>
                    <span className="block text-xs text-muted">{ROTULO_ORCAMENTO[q.status] ?? q.status}</span>
                  </span>
                  <span className="shrink-0 text-sm text-text tabular-nums" data-numeric>
                    {reais(q.total_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Casca>
  );
}

/* -------------------------------------------------------------------------- */

const ROTULO_VEREDITO: Record<string, string> = {
  conforming: 'Conforme',
  non_conforming: 'Não conforme',
  conforming_with_restriction: 'Conforme com restrição',
};

function tomDoVeredito(v: string): 'neutral' | 'info' | 'warn' | 'good' | 'bad' {
  if (v === 'conforming') return 'good';
  if (v === 'non_conforming') return 'bad';
  if (v === 'conforming_with_restriction') return 'warn';
  return 'neutral';
}

/** O vocabulário do cliente, e não o do comercial. */
const ROTULO_ORCAMENTO: Record<string, string> = {
  sent: 'Aguardando sua decisão',
  viewed: 'Aguardando sua decisão',
  approved: 'Aprovado por você',
  rejected: 'Recusado por você',
  expired: 'Vencido',
  in_execution: 'Em execução',
  invoiced: 'Faturado',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
  superseded: 'Substituído por uma versão nova',
};
