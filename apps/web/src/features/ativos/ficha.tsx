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
 *
 * A FOTO DO EQUIPAMENTO (ATV-07) abre a ficha e sai na impressão: é o que faz
 * a pessoa no setor reconhecer o aparelho sem ler a tag. Os bytes vêm de
 * `GET /assets/:id/photo`, com o mesmo escopo da ficha.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { BadgeCheck, CalendarDays, Camera, MapPin, Pencil, QrCode, ShieldAlert, Wrench } from 'lucide-react';
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
  assetIndicators,
  assetsLifeRecord,
  assetPhoto,
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
import { QrSvg, enderecoDaEtiqueta } from '../../shell/qr';
import { BotaoLaudoDeObsolescencia } from './laudo';
import { CartaoAnvisa } from './anvisa';
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
      subtitle={[
        data.family_name,
        // O nome já é o do catálogo (ATV-08): repetir o tipo igual ao título seria ruído.
        data.category_name !== data.name ? data.category_name : null,
        data.manufacturer_name,
        data.model_name,
      ]
        .filter(Boolean)
        .join(' · ')}
      breadcrumbs={[{ label: 'Ativos', href: '/ativos' }, { label: data.tag ?? data.name }]}
      actions={
        <>
          <Can permission="asset.update">
            <Button icon={<Pencil className="size-4" />} onClick={() => setEditando(true)}>
              Editar
            </Button>
          </Can>
          {/* Laudo de obsolescência: só para equipamento ainda em operação (conversa de 21/10/2026). */}
          {data.status !== 'decommissioned' && data.status !== 'disposed' && (
            <Can permission="asset.decommission">
              <BotaoLaudoDeObsolescencia assetId={data.id} nome={data.name} />
            </Can>
          )}
        </>
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
          anvisa_not_applicable: data.anvisa_not_applicable ?? false,
          acquired_at: data.acquired_at ?? null,
          useful_life_years: data.useful_life_years ?? null,
          purchase_value: data.purchase_value ?? null,
          residual_value: data.residual_value ?? null,
          acquisition_invoice: data.acquisition_invoice ?? null,
          sla_enabled: data.sla_enabled ?? true,
          sla_policy_id: data.sla_policy_id,
          tem_foto: Boolean(data.photo),
        }}
      />
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
            <FotoDoEquipamento ativo={data} />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
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
                <Info
                  rotulo="SLA"
                  valor={
                    data.sla_enabled === false
                      ? 'Desabilitado'
                      : data.sla_policy_name
                        ? `Habilitado · ${data.sla_policy_name}`
                        : 'Habilitado · herdado'
                  }
                />
              </dl>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="flex flex-col gap-4">
              <IndicadoresDoAtivo assetId={id} />
              <HistoricoDeOs assetId={id} />
              <FichaDeVidaDoAtivo assetId={id} />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {data.qr_token && <CartaoEtiqueta ativo={data} />}

            <CartaoAnvisa ativo={data} />

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

            {data.depreciation && <CartaoDeDepreciacao d={data.depreciation} moedaDoBem={data.currency} />}

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
                  <Info rotulo="Nota fiscal de aquisição" valor={data.acquisition_invoice ?? null} />
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
 * A foto do equipamento (ATV-07). Pedida só quando existe; o arquivo vira um
 * endereço local (`blob:`) que a impressão também leva. Sem foto — o parque
 * cadastrado antes da exigência —, o quadro diz isso em vez de ficar vazio.
 */
function FotoDoEquipamento({ ativo }: { ativo: AssetDetail }) {
  const temFoto = Boolean(ativo.photo);
  const { data: arquivo, isError } = useApiQuery(
    assetPhoto,
    { params: { id: ativo.id } },
    { enabled: temFoto, staleTime: 5 * 60_000 }
  ) as { data: Blob | undefined; isError: boolean };
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!arquivo) {
      setUrl(null);
      return;
    }
    const endereco = URL.createObjectURL(arquivo);
    setUrl(endereco);
    return () => URL.revokeObjectURL(endereco);
  }, [arquivo]);

  if (url) {
    return (
      <img
        src={url}
        alt={`Foto do equipamento ${ativo.name}`}
        className="h-40 w-full shrink-0 rounded-card border border-border-subtle object-cover sm:w-40"
      />
    );
  }
  return (
    <div
      className="flex h-40 w-full shrink-0 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-border-strong bg-surface-subtle text-center text-xs text-muted sm:w-40"
      role={temFoto ? undefined : 'note'}
    >
      <Camera aria-hidden="true" className="size-5 text-subtle" />
      {temFoto ? (isError ? 'Foto indisponível' : 'Carregando a foto…') : 'Sem foto cadastrada'}
    </div>
  );
}

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
/**
 * A etiqueta do equipamento, com o QR desenhado (conversa com o cliente, 21/10/2026).
 * O QR carrega o endereço `/q/<token>`: ler com a câmera abre este equipamento no sistema.
 * "Imprimir etiqueta" imprime só este cartão, e não a ficha inteira.
 */
function CartaoEtiqueta({ ativo }: { ativo: AssetDetail }) {
  const token = ativo.qr_token;
  if (!token) return null;
  function imprimirEtiqueta() {
    document.body.dataset.imprimir = 'etiqueta';
    const limpar = () => {
      delete document.body.dataset.imprimir;
      window.removeEventListener('afterprint', limpar);
    };
    window.addEventListener('afterprint', limpar);
    window.print();
  }
  return (
    <Card className="aurora-etiqueta">
      <CardHeader title="Etiqueta QR" description="Leia com a câmera para abrir este equipamento." />
      <div className="flex flex-col items-center gap-3 p-4">
        <QrSvg
          texto={enderecoDaEtiqueta(token)}
          rotulo={`QR code do equipamento ${ativo.tag ?? ativo.name}`}
        />
        <p className="text-center text-sm font-semibold text-text">{ativo.tag ?? ativo.name}</p>
        <p className="text-center text-xs text-muted">{ativo.name}</p>
        <Button size="sm" className="aurora-no-print" onClick={imprimirEtiqueta}>
          Imprimir etiqueta
        </Button>
      </div>
    </Card>
  );
}

/** Minutos em linguagem de gente: "45 min", "3 h 20 min", "2 d 4 h". */
export function duracao(minutos: number | null | undefined): string {
  if (minutos === null || minutos === undefined) return '—';
  const m = Math.round(minutos);
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  const d = Math.floor(m / (60 * 24));
  const h = Math.floor((m % (60 * 24)) / 60);
  return `${d} d${h ? ` ${h} h` : ''}`;
}

/**
 * Indicadores PONTUAIS deste equipamento (conversa com o cliente, 21/10/2026): o que o
 * painel mostra para o parque, aqui só para ele. MTTR e MTBF vêm vazios quando não há
 * amostra — "—" com a explicação, nunca zero.
 */
function IndicadoresDoAtivo({ assetId }: { assetId: string }) {
  const { data, isLoading } = useApiQuery(assetIndicators, { params: { id: assetId } }) as {
    data: import('@aurora/contracts').AssetIndicators | undefined;
    isLoading: boolean;
  };
  return (
    <Card>
      <CardHeader
        title="Indicadores do equipamento"
        description={data ? `Últimos ${data.period.days} dias.` : 'Calculando…'}
      />
      {isLoading || !data ? (
        <div className="p-4">
          <SkeletonList rows={2} label="indicadores" />
        </div>
      ) : (
        <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Indicador
            rotulo="Ordens de serviço"
            valor={String(data.work_orders.total)}
            dica={`${data.work_orders.corrective} corretivas · ${data.work_orders.preventive} preventivas · ${data.work_orders.open} abertas`}
          />
          <Indicador
            rotulo="MTTR (tempo de reparo)"
            valor={duracao(data.mttr_minutes)}
            dica={
              data.mttr_minutes === null
                ? 'Sem corretiva concluída no período'
                : `${data.mttr_samples} corretivas`
            }
          />
          <Indicador
            rotulo="MTBF (entre falhas)"
            valor={duracao(data.mtbf_minutes)}
            dica={
              data.mtbf_minutes === null
                ? 'Precisa de duas corretivas no período'
                : `${data.mtbf_samples} intervalos`
            }
          />
          <Indicador
            rotulo="Tempo parado"
            valor={duracao(data.downtime_minutes)}
            dica="Soma do tempo das corretivas concluídas"
          />
        </dl>
      )}
    </Card>
  );
}

function Indicador({ rotulo, valor, dica }: { rotulo: string; valor: string; dica: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-subtle">{rotulo}</dt>
      <dd className="text-xl font-semibold text-text tabular-nums" data-numeric>
        {valor}
      </dd>
      <p className="text-xs text-muted">{dica}</p>
    </div>
  );
}

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

/* -------------------------------------------------------------------------- */
/* ficha de vida (ATV-13)                                                      */
/* -------------------------------------------------------------------------- */

type FichaDeVida = {
  plans: AssetLifePlanRow[] | null;
  procedures: AssetLifeProcedureRow[] | null;
  field_changes: AssetFieldChangeRow[] | null;
};
type AssetLifePlanRow = {
  plan_id: string;
  plan_name: string;
  plan_active: boolean;
  task_id: string;
  task_name: string;
  target_kind: 'asset' | 'asset_category' | 'location_subtree';
  frequency_unit: string;
  frequency_interval: number;
};
type AssetLifeProcedureRow = {
  response_id: string;
  work_order_id: string;
  work_order_number: string | null;
  template_title: string;
  template_version: number;
  started_at: string;
  finished_at: string | null;
  answers: { pass: number; fail: number; na: number };
};
type AssetFieldChangeRow = {
  at: string;
  actor_name: string | null;
  action: 'create' | 'update' | 'delete' | 'restore';
  changes: { field: string; from: unknown; to: unknown }[];
};

const ROTULO_FREQUENCIA: Record<string, [string, string]> = {
  day: ['dia', 'dias'],
  week: ['semana', 'semanas'],
  month: ['mês', 'meses'],
  quarter: ['trimestre', 'trimestres'],
  semester: ['semestre', 'semestres'],
  year: ['ano', 'anos'],
};
const ROTULO_ALVO: Record<string, string> = {
  asset: 'este equipamento',
  asset_category: 'o tipo do equipamento',
  location_subtree: 'o local do equipamento',
};
const ROTULO_ACAO: Record<string, string> = {
  create: 'Cadastrado',
  update: 'Alterado',
  delete: 'Excluído',
  restore: 'Restaurado',
};

function valorDeCampo(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Planos que cobrem o equipamento, procedimentos executados nele e o histórico de alterações de
 * campo. Cada parte só aparece para quem tem a permissão dela — o servidor a manda `null`.
 */
function FichaDeVidaDoAtivo({ assetId }: { assetId: string }) {
  const { data, isLoading } = useApiQuery(assetsLifeRecord, { params: { id: assetId } }) as {
    data: FichaDeVida | undefined;
    isLoading: boolean;
  };
  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Ficha de vida" />
        <div className="p-4">
          <SkeletonList rows={4} label="ficha de vida" />
        </div>
      </Card>
    );
  }
  if (!data) return null;
  const { plans, procedures, field_changes: mudancas } = data;
  if (plans === null && procedures === null && mudancas === null) return null;

  return (
    <Card>
      <CardHeader
        title="Ficha de vida"
        description="Planos que cobrem o equipamento, procedimentos executados e alterações de cadastro."
      />
      <div className="flex flex-col gap-5 p-4 text-sm">
        {plans !== null && (
          <section aria-label="Planos de manutenção">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Planos</h3>
            {plans.length === 0 ? (
              <p className="text-muted">Nenhum plano de manutenção cobre este equipamento.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {plans.map((p) => {
                  const [um, varios] = ROTULO_FREQUENCIA[p.frequency_unit] ?? [
                    p.frequency_unit,
                    p.frequency_unit,
                  ];
                  return (
                    <li key={p.task_id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-text">{p.plan_name}</span>
                      <span className="text-muted">
                        · {p.task_name} · a cada{' '}
                        {p.frequency_interval > 1 ? `${p.frequency_interval} ${varios}` : um} · por{' '}
                        {ROTULO_ALVO[p.target_kind] ?? p.target_kind}
                      </span>
                      {!p.plan_active && (
                        <StatusChip tone="neutral" size="sm">
                          Plano inativo
                        </StatusChip>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {procedures !== null && (
          <section aria-label="Procedimentos executados">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Procedimentos executados
            </h3>
            {procedures.length === 0 ? (
              <p className="text-muted">Nenhum procedimento ou checklist executado neste equipamento.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {procedures.map((p) => (
                  <li key={p.response_id} className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      to="/ordens/$id"
                      params={{ id: p.work_order_id }}
                      className="font-medium text-accent"
                    >
                      {p.work_order_number ?? 'OS'}
                    </Link>
                    <span className="text-text">
                      {p.template_title} (v{p.template_version})
                    </span>
                    <span className="text-xs text-muted" data-numeric>
                      {formatarDataRelativa(p.started_at)} · {p.answers.pass} conforme
                      {p.answers.pass === 1 ? '' : 's'} · {p.answers.fail} não conforme
                      {p.answers.fail === 1 ? '' : 's'}
                      {p.finished_at ? '' : ' · em andamento'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {mudancas !== null && (
          <section aria-label="Histórico de alterações">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Histórico de alterações
            </h3>
            {mudancas.length === 0 ? (
              <p className="text-muted">Nenhuma alteração registrada.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {mudancas.map((m, i) => (
                  <li key={`${m.at}-${i}`}>
                    <span className="text-text">{ROTULO_ACAO[m.action] ?? m.action}</span>
                    <span className="text-xs text-muted" data-numeric>
                      {' '}
                      · {formatarDataRelativa(m.at)}
                      {m.actor_name ? ` · ${m.actor_name}` : ''}
                    </span>
                    {m.changes.length > 0 && (
                      <ul className="mt-0.5 flex flex-col text-xs text-muted">
                        {m.changes.map((c) => (
                          <li key={c.field}>
                            <code>{c.field}</code>: {valorDeCampo(c.from)} → {valorDeCampo(c.to)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Card>
  );
}

type Depreciacao = NonNullable<AssetDetail['depreciation']>;

/**
 * A depreciação em linha reta, como o cliente pediu em 21/10/2026: uma BARRA que
 * mostra quanto da vida útil já passou e quanto resta. O percentual e os anos são de
 * quem vê o equipamento; os valores só aparecem quando vieram do servidor (quem tem
 * permissão financeira e há valor de compra).
 */
function CartaoDeDepreciacao({ d, moedaDoBem }: { d: Depreciacao; moedaDoBem?: string | null }) {
  const pct = Math.min(100, Math.max(0, d.percentDepreciated));
  const tom = d.fullyDepreciated ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-accent';
  return (
    <Card>
      <CardHeader
        title="Depreciação"
        description="Linha reta, a partir da data de aquisição e pela vida útil informada."
      />
      <div className="flex flex-col gap-3 p-4 text-sm">
        <div
          role="progressbar"
          aria-label="Vida útil consumida"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${pct.toFixed(0)} % da vida útil consumida`}
          className="h-3 w-full overflow-hidden rounded-full bg-surface-sunken"
        >
          <div className={cn('h-full rounded-full', tom)} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-muted">
          <span className="font-medium text-text">{pct.toFixed(0)} %</span> depreciado ·{' '}
          {d.fullyDepreciated
            ? 'vida útil esgotada'
            : `restam ${d.remainingYears.toFixed(1).replace('.', ',')} anos`}
        </p>
        {d.bookValue !== null && (
          <dl className="flex flex-col gap-2">
            <Info rotulo="Valor contábil atual" valor={moeda(String(d.bookValue), moedaDoBem)} />
            <Info rotulo="Depreciação por ano" valor={moeda(String(d.annualDepreciation), moedaDoBem)} />
            <Info
              rotulo="Depreciação acumulada"
              valor={moeda(String(d.accumulatedDepreciation), moedaDoBem)}
            />
          </dl>
        )}
        {d.methodology && (
          /*
           * A metodologia, explícita (ATV-10): de onde o número saiu. Linha reta é o único método —
           * não há escolha de outro, e nenhuma norma contábil é inventada aqui.
           */
          <details className="rounded-control border border-border-subtle px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted">Como foi calculado</summary>
            <dl className="mt-2 flex flex-col gap-2">
              <Info rotulo="Método" valor="Linha reta (cotas iguais por ano)" />
              <Info rotulo="Data-base (aquisição)" valor={formatarData(d.methodology.baseDate)} />
              <Info rotulo="Vida útil" valor={`${d.methodology.usefulLifeYears} anos`} />
              <Info rotulo="Fim da vida útil" valor={formatarData(d.methodology.endDate)} />
              {d.methodology.residualValue !== null && (
                <Info
                  rotulo="Valor residual"
                  valor={moeda(String(d.methodology.residualValue), moedaDoBem)}
                />
              )}
              {d.methodology.depreciableBase !== null && (
                <Info
                  rotulo="Base depreciável (compra − residual)"
                  valor={moeda(String(d.methodology.depreciableBase), moedaDoBem)}
                />
              )}
            </dl>
            <p className="mt-2 text-xs text-muted">
              Depreciação por ano = base depreciável ÷ vida útil. Calculado no servidor; as alterações de
              data, vida útil e valores ficam no histórico de alterações.
            </p>
          </details>
        )}
      </div>
    </Card>
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
