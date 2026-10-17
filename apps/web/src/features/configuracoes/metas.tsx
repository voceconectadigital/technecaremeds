/**
 * Aurora — metas dos indicadores (relatórios Basic / Advanced / Expert, Fase 1).
 *
 * A meta NÃO está no código: é configuração por indicador × organização ×
 * cliente × contrato × vigência. A mais específica vale (contrato → cliente →
 * organização); sem nenhuma em vigor, o relatório diz SEM META CONFIGURADA — e
 * nunca assume zero.
 *
 * Quem tem `insight.manage_targets` (gestor, administrador) configura; os
 * demais só leem. Esconder o botão é conveniência — quem nega é o servidor.
 *
 * Por indicador, não por formulário gigante: uma linha por indicador, as metas
 * dele logo abaixo, e um diálogo curto para criar ou ajustar.
 */
import { useMemo, useState } from 'react';
import { Pencil, Plus, Target, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonList,
  StatusChip,
  useToast,
} from '@aurora/ui';
import {
  contractsList,
  customersList,
  indicatorTargetsArchive,
  indicatorTargetsCreate,
  indicatorTargetsList,
  indicatorTargetsUpdate,
  reportsCatalog,
} from '@aurora/contracts';
import { ApiError, hojeLocal, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { AlternadorDeConfiguracoes } from './alternador';

type Direcao = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
type Indicador = {
  key: string;
  label: string;
  unit: string;
  state: 'ACTIVE' | 'PROVISIONAL' | 'PENDING_DEFINITION';
  target_direction: Direcao | 'INFORMATIONAL';
};
type Meta = {
  id: string;
  indicator_key: string;
  customer_id: string | null;
  contract_id: string | null;
  scope: 'contract' | 'customer' | 'organization';
  valid_from: string;
  valid_to: string | null;
  value: number;
  unit: string;
  direction: Direcao;
  timeline: 'active' | 'future' | 'expired';
  note: string | null;
};
type Cliente = { id: string; name: string };
type Contrato = { id: string; number: string; title: string | null; customer_id: string };

const UNIDADE: Record<string, string> = {
  percent: '%',
  minutes: 'min',
  hours: 'h',
  score: 'de 5',
  count: 'un.',
};
const SENTIDO: Record<Direcao, string> = {
  HIGHER_IS_BETTER: '≥ maior é melhor',
  LOWER_IS_BETTER: '≤ menor é melhor',
};
const TIMELINE: Record<Meta['timeline'], { rotulo: string; tom: 'good' | 'warn' | 'neutral' }> = {
  active: { rotulo: 'Meta ativa', tom: 'good' },
  future: { rotulo: 'Meta futura', tom: 'warn' },
  expired: { rotulo: 'Meta expirada', tom: 'neutral' },
};

/** ACTIVE primeiro: é o que já aparece em relatório. A ordem do catálogo se mantém dentro de cada grupo. */
const ORDEM_ESTADO: Record<Indicador['state'], number> = { ACTIVE: 0, PROVISIONAL: 1, PENDING_DEFINITION: 2 };

const dia = (iso: string) => iso.split('-').reverse().join('/');
const numero = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

export function MetasPage() {
  const { can } = usePermissions();
  const edita = can('insight.manage_targets');
  const [cliente, setCliente] = useState('');
  const [dialogo, setDialogo] = useState<{ indicador?: string; meta?: Meta } | null>(null);

  const { data: catalogo, isLoading: carregandoCatalogo } = useApiQuery(reportsCatalog) as {
    data: { indicators: Indicador[] } | undefined;
    isLoading: boolean;
  };
  const { data: metas, isLoading: carregandoMetas } = useApiQuery(indicatorTargetsList, {
    query: cliente ? { customer_id: cliente } : {},
  }) as { data: { items: Meta[] } | undefined; isLoading: boolean };
  const { data: clientes } = useApiQuery(customersList) as { data: { items: Cliente[] } | undefined };

  const indicadores = useMemo(
    () => (catalogo?.indicators ?? []).filter((i) => i.target_direction !== 'INFORMATIONAL'),
    [catalogo]
  );
  // O mesmo indicador está em vários modelos: a lista é por indicador, uma vez só.
  const unicos = useMemo(
    () =>
      [...new Map(indicadores.map((i) => [i.key, i])).values()].sort(
        (a, b) => ORDEM_ESTADO[a.state] - ORDEM_ESTADO[b.state]
      ),
    [indicadores]
  );
  const nomeCliente = (id: string | null) =>
    id ? ((clientes?.items ?? []).find((c) => c.id === id)?.name ?? 'Cliente') : 'Toda a organização';

  return (
    <AppShell
      title="Metas dos indicadores"
      subtitle="A meta mais específica vale: contrato, depois cliente, depois organização."
      breadcrumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Metas' }]}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AlternadorDeConfiguracoes />
        <span className="flex-1" />
        <Select
          aria-label="Filtrar por cliente"
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
          className="w-56"
        >
          <option value="">Todos os clientes</option>
          {(clientes?.items ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {edita && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialogo({})}>
            Nova meta
          </Button>
        )}
      </div>

      {!edita && (
        <p role="note" className="mb-3 rounded-control bg-surface-sunken px-3 py-2 text-xs text-muted">
          Somente leitura: configurar metas é da gestão.
        </p>
      )}

      {carregandoCatalogo || carregandoMetas ? (
        <SkeletonList rows={6} label="metas" />
      ) : unicos.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="size-5" />}
            title="Nenhum indicador com meta"
            description="O catálogo não trouxe indicadores que aceitem meta."
          />
        </Card>
      ) : (
        <Card>
          <ul>
            {unicos.map((ind, i) => {
              const doIndicador = (metas?.items ?? []).filter((m) => m.indicator_key === ind.key);
              const ativa = doIndicador.some((m) => m.timeline === 'active');
              return (
                <li
                  key={ind.key}
                  className={`flex flex-col gap-2 px-4 py-3 ${i > 0 ? 'border-t border-border-subtle' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-text">{ind.label}</span>
                      <span className="block text-xs text-muted">
                        {SENTIDO[ind.target_direction as Direcao]} · unidade: {UNIDADE[ind.unit] ?? ind.unit}
                      </span>
                    </span>
                    {ind.state !== 'ACTIVE' && (
                      <StatusChip
                        size="sm"
                        tone="warn"
                        hint={
                          ind.state === 'PROVISIONAL'
                            ? 'Calculado pelo sistema, mas a definição ainda não foi confirmada pelo cliente.'
                            : 'A meta pode ser configurada antes; o indicador ainda não entra em relatório.'
                        }
                      >
                        {ind.state === 'PROVISIONAL' ? 'Provisório' : 'Aguardando definição'}
                      </StatusChip>
                    )}
                    {!ativa && (
                      <StatusChip size="sm" tone="neutral">
                        Sem meta
                      </StatusChip>
                    )}
                    {edita && (
                      <Button size="sm" onClick={() => setDialogo({ indicador: ind.key })}>
                        Adicionar
                      </Button>
                    )}
                  </div>
                  {doIndicador.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {doIndicador.map((m) => (
                        <LinhaDeMeta
                          key={m.id}
                          m={m}
                          alvo={nomeCliente(m.customer_id)}
                          edita={edita}
                          onEditar={() => setDialogo({ meta: m })}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {dialogo && (
        <DialogoDeMeta
          indicadores={unicos}
          clientes={clientes?.items ?? []}
          inicial={dialogo}
          onFechar={() => setDialogo(null)}
        />
      )}
    </AppShell>
  );
}

function LinhaDeMeta({
  m,
  alvo,
  edita,
  onEditar,
}: {
  m: Meta;
  alvo: string;
  edita: boolean;
  onEditar: () => void;
}) {
  const toast = useToast();
  const arquivar = useApiMutation(indicatorTargetsArchive, {
    invalidates: [indicatorTargetsList],
    onError: (e: ApiError) => toast.error('Meta não arquivada', e.problem.message),
  });
  const t = TIMELINE[m.timeline];
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-control bg-surface-sunken px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        <span className="font-medium tabular-nums text-text">
          {m.direction === 'HIGHER_IS_BETTER' ? '≥' : '≤'} {numero(m.value)} {UNIDADE[m.unit] ?? m.unit}
        </span>
        <span className="text-muted">
          {' · '}
          {m.scope === 'organization' ? 'Organização' : alvo}
          {m.scope === 'contract' ? ' · contrato' : ''}
          {' · '}
          {dia(m.valid_from)} até {m.valid_to ? dia(m.valid_to) : 'sem fim'}
        </span>
        {m.note && <span className="block text-xs text-muted">{m.note}</span>}
      </span>
      <StatusChip size="sm" tone={t.tom}>
        {t.rotulo}
      </StatusChip>
      {edita && (
        <>
          <Button
            size="sm"
            icon={<Pencil className="size-4" />}
            aria-label="Editar meta"
            onClick={onEditar}
          />
          <Button
            size="sm"
            icon={<Trash2 className="size-4" />}
            aria-label="Arquivar meta"
            loading={arquivar.isPending}
            onClick={() =>
              arquivar.mutate(
                { params: { id: m.id } },
                { onSuccess: () => toast.success('Meta arquivada', 'Continua na trilha de auditoria.') }
              )
            }
          />
        </>
      )}
    </li>
  );
}

function DialogoDeMeta({
  indicadores,
  clientes,
  inicial,
  onFechar,
}: {
  indicadores: Indicador[];
  clientes: Cliente[];
  inicial: { indicador?: string; meta?: Meta };
  onFechar: () => void;
}) {
  const toast = useToast();
  const { can } = usePermissions();
  const edicao = inicial.meta;
  const [indicador, setIndicador] = useState(edicao?.indicator_key ?? inicial.indicador ?? '');
  const [cliente, setCliente] = useState(edicao?.customer_id ?? '');
  const [contrato, setContrato] = useState(edicao?.contract_id ?? '');
  const [de, setDe] = useState(edicao?.valid_from ?? hojeLocal());
  const [ate, setAte] = useState(edicao?.valid_to ?? '');
  const [valor, setValor] = useState(edicao ? String(edicao.value) : '');
  const [nota, setNota] = useState(edicao?.note ?? '');

  const ind = indicadores.find((i) => i.key === indicador);
  const direcao = (ind?.target_direction ?? 'HIGHER_IS_BETTER') as Direcao;
  const { data: contratos } = useApiQuery(
    contractsList,
    { query: { customerId: cliente } },
    { enabled: !edicao && can('contract.read') && cliente !== '' }
  ) as { data: { items: Contrato[] } | undefined };

  const criar = useApiMutation(indicatorTargetsCreate, {
    invalidates: [indicatorTargetsList],
    onError: (e: ApiError) => toast.error('Meta não salva', e.problem.message),
  });
  const alterar = useApiMutation(indicatorTargetsUpdate, {
    invalidates: [indicatorTargetsList],
    onError: (e: ApiError) => toast.error('Meta não salva', e.problem.message),
  });

  const numeroValido = valor.trim() !== '' && Number.isFinite(Number(valor.replace(',', '.')));
  const pronto = Boolean(ind) && numeroValido && de !== '' && (ate === '' || ate >= de);
  const salvando = criar.isPending || alterar.isPending;

  function salvar() {
    const v = Number(valor.replace(',', '.'));
    if (edicao) {
      alterar.mutate(
        {
          params: { id: edicao.id },
          body: {
            value: v,
            valid_from: de,
            valid_to: ate || null,
            direction: direcao,
            note: nota.trim() || null,
          },
        },
        {
          onSuccess: () => {
            toast.success('Meta atualizada');
            onFechar();
          },
        }
      );
      return;
    }
    criar.mutate(
      {
        body: {
          indicator_key: indicador,
          ...(cliente ? { customer_id: cliente } : {}),
          ...(contrato ? { contract_id: contrato } : {}),
          valid_from: de,
          ...(ate ? { valid_to: ate } : {}),
          value: v,
          direction: direcao,
          ...(nota.trim() ? { note: nota.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success('Meta criada');
          onFechar();
        },
      }
    );
  }

  return (
    <Dialog
      open
      size="md"
      onOpenChange={(o) => !o && onFechar()}
      title={edicao ? 'Ajustar meta' : 'Nova meta'}
      description="Vale do início ao fim da vigência. Sem fim, vale até ser substituída."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button variant="primary" disabled={!pronto} loading={salvando} onClick={salvar}>
            Salvar meta
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Indicador">
            <Select
              value={indicador}
              disabled={Boolean(edicao)}
              onChange={(e) => setIndicador(e.target.value)}
            >
              <option value="">Escolha…</option>
              {indicadores.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Cliente" hint="Vazio = vale para a organização inteira">
          <Select
            value={cliente}
            disabled={Boolean(edicao)}
            onChange={(e) => {
              setCliente(e.target.value);
              setContrato('');
            }}
          >
            <option value="">Toda a organização</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {!edicao && can('contract.read') && cliente !== '' && (contratos?.items.length ?? 0) > 0 ? (
          <Field label="Contrato" hint="Opcional: a meta do contrato vence a do cliente">
            <Select value={contrato} onChange={(e) => setContrato(e.target.value)}>
              <option value="">Todos os contratos do cliente</option>
              {(contratos?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number}
                  {c.title ? ` — ${c.title}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <span />
        )}
        <Field label="Início da vigência">
          <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </Field>
        <Field label="Fim da vigência" hint="Opcional">
          <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </Field>
        <Field label={`Meta${ind ? ` (${UNIDADE[ind.unit] ?? ind.unit})` : ''}`}>
          <Input
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="Ex.: 95"
          />
        </Field>
        <Field label="Sentido" hint="Definido pelo indicador">
          <Input value={ind ? SENTIDO[direcao] : '—'} readOnly />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observação" hint="Opcional — por exemplo, a cláusula do contrato">
            <Input value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
