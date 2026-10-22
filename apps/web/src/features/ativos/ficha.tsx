/**
 * Aurora — ficha do equipamento (SPEC v0.2 §06 · EPIC-005).
 *
 * A PERGUNTA QUE ESTA TELA RESPONDE é "vale a pena consertar de novo?".
 *
 * Não é uma tela de cadastro. É onde alguém decide, com o orçamento na mão, se
 * este aparelho continua ou é substituído — e essa decisão precisa de três
 * coisas juntas: o que ele é, quanto ele já deu trabalho, e o que ele custa.
 *
 * Por isso o histórico de ordens de serviço fica na primeira dobra, e não
 * escondido numa aba. Um equipamento com nove corretivas em oito meses conta
 * uma história que a ficha cadastral não conta.
 *
 * O QUE ESTA TELA NÃO MOSTRA A QUEM NÃO PODE VER
 *
 * Valor de compra, residual e reposição não chegam do servidor sem
 * `asset.read_financials`; observação interna, sem
 * `asset.read_internal_notes`. A tela não esconde: o campo vem nulo, e o bloco
 * inteiro deixa de existir. É a diferença entre "não está na tela" e "não
 * saiu do servidor".
 */
import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { BadgeCheck, CalendarDays, MapPin, Pencil, QrCode, ShieldAlert, Wrench } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Skeleton,
  SkeletonList,
  StatusChip,
  cn,
  useToast,
} from '@aurora/ui';
import {
  assetDetail,
  assetsLinkQr,
  assetsList,
  workOrdersList,
  type AssetDetail,
  type WorkOrderRow,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { DialogoEquipamento, TIPOS_DE_RASTREADOR } from './formulario';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { formatarDataRelativa, PrioridadeChip } from '../../routes/hoje';
import { tomDaCategoria } from '../ordens/lista';

export function AtivoPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const [editando, setEditando] = useState(false);

  const { data, isLoading, isError, error } = useApiQuery(assetDetail, { params: { id } }) as {
    data: AssetDetail | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;

  if (isLoading || !data) {
    return (
      <AppShell title="Equipamento">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  const financeiroVisivel = data.purchase_value != null || data.replacement_value != null;

  return (
    <AppShell
      title={data.name}
      subtitle={[data.family_name, data.category_name, data.manufacturer_name, data.model_name]
        .filter(Boolean)
        .join(' · ')}
      breadcrumbs={[{ label: 'Ativos', href: '/ativos' }, { label: data.tag ?? data.name }]}
      actions={
        <Can permission="asset.update">
          <Button icon={<Pencil className="size-4" />} onClick={() => setEditando(true)}>
            Editar
          </Button>
        </Can>
      }
    >
      <DialogoEquipamento
        open={editando}
        onOpenChange={setEditando}
        inicial={{
          id: data.id,
          name: data.name,
          customer_id: data.customer_id,
          location_id: data.location_id,
          asset_category_id: data.asset_category_id,
          asset_model_id: data.asset_model_id,
          criticality_id: data.criticality_id,
          tag: data.tag,
          serial_number: data.serial_number,
          asset_number: data.asset_number,
          tracker_kind: data.tracker_kind ?? null,
          tracker_tag: data.tracker_tag ?? null,
          anvisa_registration: data.anvisa_registration ?? null,
          acquired_at: data.acquired_at ?? null,
          useful_life_years: data.useful_life_years ?? null,
          purchase_value: data.purchase_value ?? null,
          acquisition_invoice: data.acquisition_invoice ?? null,
        }}
      />
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={data.status === 'active' ? 'good' : 'neutral'}>
                {ROTULO_SITUACAO[data.status] ?? data.status}
              </StatusChip>
              {data.under_warranty && (
                <StatusChip tone="info" size="sm">
                  <BadgeCheck aria-hidden="true" className="mr-1 inline size-3" />
                  Na garantia
                </StatusChip>
              )}
              {data.requires_calibration && (
                <StatusChip tone="warn" size="sm">
                  Exige calibração
                </StatusChip>
              )}
              {data.requires_electrical_test && (
                <StatusChip tone="warn" size="sm">
                  Exige ensaio elétrico
                </StatusChip>
              )}
              {data.risk_class && (
                <StatusChip tone="neutral" size="sm">
                  <ShieldAlert aria-hidden="true" className="mr-1 inline size-3" />
                  Classe {data.risk_class}
                </StatusChip>
              )}
            </div>

            {data.decommissioned_at && (
              <p className="rounded-control bg-surface-sunken px-3 py-2 text-sm text-muted">
                Baixado em {new Date(data.decommissioned_at).toLocaleDateString('pt-BR')}
                {data.decommission_reason ? `: ${data.decommission_reason}` : '.'}
              </p>
            )}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Info rotulo="Cliente / Hospital" valor={data.customer_name ?? null} />
              <Info
                rotulo="Setor"
                valor={data.location_name}
                vazio="Sem setor"
                icone={<MapPin className="size-3.5" />}
              />
              <Info rotulo="Patrimônio" valor={data.tag ?? data.asset_number} />
              <Info rotulo="Número de série" valor={data.serial_number} />
              <Info
                rotulo="Idade"
                valor={
                  data.age_years === null
                    ? null
                    : `${data.age_years.toFixed(1)} ${data.age_years === 1 ? 'ano' : 'anos'}`
                }
                // Nula é diferente de zero: zero diria "novo", e o que se sabe
                // aqui é que ninguém informou nenhuma das três datas.
                vazio="Sem data de origem"
                icone={<CalendarDays className="size-3.5" />}
              />
            </dl>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <HistoricoDeOs assetId={id} />
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader title="Ciclo de vida" />
              <dl className="flex flex-col gap-3 p-4 text-sm">
                <Info rotulo="Fabricação" valor={formatarData(data.manufactured_at)} />
                <Info rotulo="Aquisição" valor={formatarData(data.acquired_at)} />
                <Info rotulo="Instalação" valor={formatarData(data.installed_at)} />
                <Info
                  rotulo="Garantia até"
                  valor={formatarData(data.warranty_until)}
                  vazio="Sem garantia registrada"
                />
                <Info
                  rotulo="Vida útil"
                  valor={data.useful_life_years ? `${data.useful_life_years} anos` : null}
                />
                <Info rotulo="Posse" valor={ROTULO_POSSE[data.ownership] ?? data.ownership} />
              </dl>
            </Card>

            {financeiroVisivel && (
              /*
               * O bloco inteiro só existe quando os valores existem.
               *
               * Um cartão "Valores" com três traços não é neutro: ensina que
               * o equipamento não tem valor cadastrado, quando na verdade quem
               * está olhando é que não pode vê-lo. Melhor não existir.
               */
              <Card>
                <CardHeader title="Valores" description="Visível para quem tem permissão financeira." />
                <dl className="flex flex-col gap-3 p-4 text-sm">
                  <Info rotulo="Compra" valor={moeda(data.purchase_value, data.currency)} />
                  <Info rotulo="Residual" valor={moeda(data.residual_value, data.currency)} />
                  <Info rotulo="Reposição" valor={moeda(data.replacement_value, data.currency)} />
                </dl>
              </Card>
            )}

            {Object.keys(data.specs).length > 0 && (
              <Card>
                <CardHeader
                  title="Especificações"
                  description="As do modelo, com as deste equipamento por cima."
                />
                <dl className="flex flex-col gap-2 p-4 text-sm">
                  {Object.entries(data.specs).map(([chave, valor]) => {
                    const sobrescrita = data.specs_overridden.includes(chave);
                    return (
                      <div key={chave} className="flex items-baseline justify-between gap-3">
                        <dt className="text-xs text-subtle">{chave}</dt>
                        <dd
                          className={cn(
                            'text-right text-sm',
                            // Marcado porque a diferença importa: uma
                            // especificação sobrescrita significa que ESTE
                            // aparelho não é mais igual ao modelo dele.
                            sobrescrita ? 'font-medium text-text' : 'text-muted'
                          )}
                          title={sobrescrita ? 'Diferente do modelo' : undefined}
                        >
                          {String(valor)}
                          {sobrescrita && <span className="ml-1 text-accent">•</span>}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </Card>
            )}

            {data.internal_notes && (
              <Card>
                <CardHeader title="Observação interna" description="O cliente não vê." />
                <p className="p-4 text-sm whitespace-pre-wrap text-text">{data.internal_notes}</p>
              </Card>
            )}

            <CartaoIdentificacao ativo={data} />
          </div>
        </div>

        {data.transfers.length > 0 && (
          <Card>
            <CardHeader title="Movimentações" description="Onde este equipamento já esteve." />
            <ul className="flex flex-col">
              {data.transfers.map((t, i) => (
                <li
                  key={t.id}
                  className={cn(
                    'flex items-baseline gap-3 px-4 py-2.5 text-sm',
                    i > 0 && 'border-t border-border-subtle'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-text">{ROTULO_MOVIMENTO[t.kind] ?? t.kind}</span>
                    {t.reason && <span className="block text-xs text-muted">{t.reason}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted" data-numeric>
                    {formatarDataRelativa(t.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O histórico de ordens deste equipamento.
 *
 * Fica na primeira dobra porque é o que responde "vale a pena consertar de
 * novo?". Nove corretivas em oito meses é a informação; a data de aquisição
 * não é.
 *
 * O filtro é do SERVIDOR (`?asset=`). Trazer a lista inteira e peneirar aqui
 * funcionaria com trinta ordens e não com cem mil — e "não funcionar" aqui
 * significa a página não abrir.
 */
function HistoricoDeOs({ assetId }: { assetId: string }) {
  const { data, isLoading } = useApiQuery(workOrdersList, {
    query: { asset: assetId, limit: 50 },
  }) as { data: { items: WorkOrderRow[] } | undefined; isLoading: boolean };

  const itens = data?.items ?? [];

  return (
    <Card>
      <CardHeader
        title="Histórico de atendimentos"
        description="O que já foi feito neste equipamento."
        actions={
          itens.length > 0 && (
            <span className="text-sm font-semibold text-text tabular-nums" data-numeric>
              {itens.length}
              {itens.length === 50 ? '+' : ''}
            </span>
          )
        }
      />
      <div className="p-2">
        {isLoading ? (
          <SkeletonList rows={5} label="atendimentos" />
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<Wrench className="size-5" />}
            title="Nenhum atendimento registrado"
            description="Este equipamento nunca precisou de manutenção — ou nunca foi registrada."
            className="py-6"
          />
        ) : (
          <ul>
            {itens.map((os, i) => (
              <li key={os.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                <Link
                  to="/ordens/$id"
                  params={{ id: os.id }}
                  className="flex items-center gap-3 px-2.5 py-2 transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{os.title}</span>
                    <span className="block truncate text-xs text-muted" data-numeric>
                      {os.number ?? 'sem número'} · {formatarDataRelativa(os.created_at)}
                    </span>
                  </span>
                  <PrioridadeChip prioridade={os.priority} />
                  <StatusChip tone={tomDaCategoria(os.category)} size="sm">
                    {ROTULO_CATEGORIA[os.category] ?? os.category}
                  </StatusChip>
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

const ROTULO_SITUACAO: Record<string, string> = {
  active: 'Em uso',
  under_maintenance: 'Em manutenção',
  standby: 'Reserva',
  loaned: 'Emprestado',
  decommissioned: 'Baixado',
  disposed: 'Descartado',
};

const ROTULO_POSSE: Record<string, string> = {
  owned: 'Próprio',
  leased: 'Arrendado',
  loaned: 'Em comodato',
  rented: 'Alugado',
  service_only: 'Só assistência',
};

const ROTULO_MOVIMENTO: Record<string, string> = {
  transfer: 'Transferência',
  loan: 'Empréstimo',
  return: 'Devolução',
};

const ROTULO_CATEGORIA: Record<string, string> = {
  draft: 'Rascunho',
  open: 'Aberta',
  scheduled: 'Programada',
  in_progress: 'Em execução',
  waiting: 'Aguardando',
  review: 'Em revisão',
  done: 'Concluída',
  closed: 'Fechada',
  cancelled: 'Cancelada',
};

/**
 * Identificação física: etiqueta de QR (token e vínculo de etiqueta já
 * impressa) e chip geolocalizador. Reunião 16/10/2026: VINCULAR a etiqueta
 * existente é a prioridade; a imagem do QR não é gerada aqui (não há engine de
 * QR no produto, e não se reconstrói uma para esta tela).
 */
function CartaoIdentificacao({ ativo }: { ativo: AssetDetail }) {
  const toast = useToast();
  const [vinculando, setVinculando] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const vincular = useApiMutation(assetsLinkQr, {
    invalidates: [assetDetail, assetsList],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  const rastreador = TIPOS_DE_RASTREADOR.find((t) => t.valor === ativo.tracker_kind)?.rotulo;

  return (
    <Card>
      <CardHeader
        title="Identificação"
        description="Etiqueta de QR e chip de localização."
        actions={
          <Can permission="asset.print_label">
            <Button size="sm" icon={<QrCode className="size-4" />} onClick={() => setVinculando((v) => !v)}>
              Vincular etiqueta existente
            </Button>
          </Can>
        }
      />
      <dl className="flex flex-col gap-3 p-4 text-sm">
        <Info
          rotulo="Código da etiqueta (QR)"
          valor={ativo.qr_token}
          icone={<QrCode className="size-3.5" />}
        />
        <Info rotulo="Código de barras" valor={ativo.barcode} />
        <Info
          rotulo="Chip geolocalizador / etiqueta de localização"
          valor={ativo.tracker_tag ? `${rastreador ?? ativo.tracker_kind} · ${ativo.tracker_tag}` : null}
          vazio="Nenhum vinculado"
        />
      </dl>
      {vinculando && (
        <form
          className="flex flex-col gap-3 border-t border-border-subtle p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErro(null);
            vincular.mutate(
              { params: { id: ativo.id }, body: { code: codigo } },
              {
                onSuccess: () => {
                  toast.success(
                    'Etiqueta vinculada',
                    'A etiqueta anterior deste equipamento deixou de valer.'
                  );
                  setCodigo('');
                  setVinculando(false);
                },
              }
            );
          }}
        >
          <Field
            label="Código lido da etiqueta"
            error={erro}
            hint="Cole o código ou a URL que o leitor de QR mostrar. A etiqueta antiga deixa de valer."
          >
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="…/q/XXXXXXXX" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setVinculando(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" loading={vincular.isPending}>
              Vincular
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Info({
  rotulo,
  valor,
  icone,
  vazio,
}: {
  rotulo: string;
  valor: string | null | undefined;
  icone?: React.ReactNode;
  vazio?: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs text-subtle">
        {icone}
        {rotulo}
      </dt>
      <dd className="mt-0.5 text-sm break-words text-text">
        {valor || <span className="text-subtle">{vazio ?? '—'}</span>}
      </dd>
    </div>
  );
}

function formatarData(iso: string | null): string | null {
  if (!iso) return null;
  // A data vem como `date` do PostgreSQL, sem hora e sem fuso. Passá-la por
  // `new Date()` e formatar no fuso local move o dia para trás em qualquer
  // fuso a oeste de Greenwich — e "adquirido em 31/12" vira "30/12".
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/**
 * O valor vem como TEXTO porque a coluna é `numeric`.
 *
 * Convertê-lo para número em JavaScript introduz erro de ponto flutuante em
 * dinheiro — o defeito que faz um relatório fechar com três centavos de
 * diferença e ninguém achar de onde vieram. Aqui só se formata.
 */
function moeda(valor: string | null | undefined, currency: string | null | undefined): string | null {
  if (valor == null) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: currency?.trim() || 'BRL',
  });
}
