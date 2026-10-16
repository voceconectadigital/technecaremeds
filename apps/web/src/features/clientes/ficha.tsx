/**
 * Aurora — ficha do cliente: o hospital, os SETORES dele e os equipamentos.
 *
 * SETOR NÃO É TABELA NOVA. É o local do tipo `setor` da árvore do cliente
 * (migrations 0008–0010): já tem cliente, já tem escopo de acesso, já é onde
 * o equipamento mora e por onde a preventiva o alcança. Esta tela só o torna
 * VISÍVEL — o que antes estava enterrado na árvore de locais da tela de
 * ativos.
 *
 * O nome é livre. Os atalhos (UTI, Bloco Cirúrgico…) preenchem o nome; não são
 * lista fechada nem tipo de setor — o hospital chama a UTI dele como quiser.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { Boxes, Building2, ChevronRight, LayoutGrid, MapPin, Pencil, Plus } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  SkeletonList,
  StatStrip,
  StatusChip,
  Thumb,
  cn,
  useToast,
} from '@aurora/ui';
import {
  assetsList,
  customersDetail,
  customersList,
  locationTypesList,
  locationsCreate,
  locationsUpdate,
  type AssetRow,
  type Customer,
  type CustomerLocation,
  type LocationType,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { rotuloDoSegmento } from './novo-cliente';
import { rotuloDaClassificacao } from './classificacao';
import { DialogoEditarCliente } from './editar-cliente';
import { DialogoEquipamento } from '../ativos/formulario';
import { ROTULO_STATUS_ATIVO, TOM_STATUS_ATIVO } from '../painel/rotulos';

/** Atalhos de nome. Nome livre continua valendo — não é enum. */
export const SETORES_SUGERIDOS = [
  'UTI',
  'Bloco Cirúrgico',
  'Enfermaria',
  'Pronto Atendimento',
  'Imaginologia',
];

export function ClientePage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { can } = usePermissions();
  const [novoSetor, setNovoSetor] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<CustomerLocation | null>(null);
  const [equipamentoNoSetor, setEquipamentoNoSetor] = useState<string | null>(null);
  const [editandoCliente, setEditandoCliente] = useState(false);

  const { data, isLoading, isError, error } = useApiQuery(customersDetail, { params: { id } }) as {
    data: { customer: Customer; locations: CustomerLocation[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  const { data: ativos, isLoading: carregandoAtivos } = useApiQuery(
    assetsList,
    { query: { customer: id, limit: 500 } },
    { enabled: can('asset.read') }
  ) as { data: { items: AssetRow[] } | undefined; isLoading: boolean };

  const locais = useMemo(() => data?.locations ?? [], [data]);
  const setores = useMemo(() => locais.filter((l) => l.location_type_key === 'setor'), [locais]);
  const outros = useMemo(() => locais.filter((l) => l.location_type_key !== 'setor'), [locais]);

  /** Cada equipamento no setor que o contém (o mais profundo, se houver aninhamento). */
  const porSetor = useMemo(() => {
    const m = new Map<string, AssetRow[]>();
    for (const a of ativos?.items ?? []) {
      const s = [...setores]
        .sort((x, y) => y.depth - x.depth)
        .find((x) => (a.location_path ?? '').startsWith(x.path));
      const k = s?.id ?? 'sem-setor';
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [ativos, setores]);

  if (isError) return <ErrorScreen error={error} />;
  if (isLoading || !data) {
    return (
      <AppShell title="Cliente" breadcrumbs={[{ label: 'Clientes', href: '/clientes' }, { label: '…' }]}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  const c = data.customer;
  const existentes = new Set(setores.map((s) => s.name.trim().toLowerCase()));
  const sugeridos = SETORES_SUGERIDOS.filter((n) => !existentes.has(n.toLowerCase()));
  const semSetor = porSetor.get('sem-setor') ?? [];

  return (
    <AppShell
      title={c.name}
      subtitle={[
        c.trade_name && c.trade_name !== c.name ? c.trade_name : null,
        rotuloDaClassificacao(c) ?? rotuloDoSegmento(c.segment),
        c.tax_id,
      ]
        .filter(Boolean)
        .join(' · ')}
      breadcrumbs={[{ label: 'Clientes', href: '/clientes' }, { label: c.name }]}
      actions={
        <div className="flex flex-wrap gap-2">
          <Can permission="customer.update">
            <Button onClick={() => setEditandoCliente(true)}>Editar cliente</Button>
          </Can>
          <Can permission="asset.create">
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setEquipamentoNoSetor('')}
            >
              Novo equipamento
            </Button>
          </Can>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <StatStrip
          items={[
            { label: 'Setores', value: setores.length },
            { label: 'Equipamentos', value: c.asset_count },
            { label: 'Locais mapeados', value: c.location_count },
            { label: 'Sem setor', value: semSetor.length, tone: semSetor.length > 0 ? 'warn' : undefined },
          ]}
        />

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <LayoutGrid className="size-4 text-accent-text" aria-hidden="true" />
                Setores
              </span>
            }
            description="Onde os equipamentos deste cliente ficam. É por eles que a preventiva os alcança e o painel os conta."
            actions={
              <Can permission="location.create">
                <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setNovoSetor('')}>
                  Novo setor
                </Button>
              </Can>
            }
          />
          <div className="flex flex-col gap-4 px-4 pb-4">
            {can('location.create') && sugeridos.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Atalhos de setor">
                <span className="text-xs text-muted">Atalhos:</span>
                {sugeridos.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNovoSetor(n)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-border-strong px-3 text-sm text-muted transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-text"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    {n}
                  </button>
                ))}
              </div>
            )}

            {setores.length === 0 ? (
              <EmptyState
                icon={<LayoutGrid className="size-5" />}
                title="Nenhum setor cadastrado"
                description="Crie os setores do hospital — UTI, Bloco Cirúrgico, Enfermaria… — e ligue cada equipamento ao seu."
                className="py-6"
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {setores.map((s) => {
                  const lista = porSetor.get(s.id) ?? [];
                  const unidade = locais.find((l) => l.id === s.parent_id);
                  return (
                    <li
                      key={s.id}
                      className="flex flex-col gap-3 rounded-card border border-card-border bg-surface p-4 shadow-card"
                    >
                      <div className="flex items-start gap-3">
                        <Thumb name={s.name} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-semibold text-text">{s.name}</p>
                          <p className="truncate text-xs text-muted">{unidade ? unidade.name : 'Setor'}</p>
                        </div>
                        <Can permission="location.update">
                          <button
                            type="button"
                            onClick={() => setRenomeando(s)}
                            aria-label={`Renomear ${s.name}`}
                            className="flex size-8 items-center justify-center rounded-control text-subtle hover:bg-surface-hover hover:text-text"
                          >
                            <Pencil className="size-4" />
                          </button>
                        </Can>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm text-muted" data-numeric>
                          <Boxes className="size-4" aria-hidden="true" />
                          {s.asset_count ?? lista.length}{' '}
                          {(s.asset_count ?? lista.length) === 1 ? 'equipamento' : 'equipamentos'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Can permission="asset.create">
                            <Button size="sm" variant="ghost" onClick={() => setEquipamentoNoSetor(s.id)}>
                              + Equipamento
                            </Button>
                          </Can>
                          <Link
                            to="/ativos"
                            search={{ local: s.id } as never}
                            className="inline-flex min-h-8 items-center gap-0.5 rounded-control px-2 text-sm text-accent-text hover:bg-accent-soft"
                          >
                            Ver <ChevronRight className="size-4" aria-hidden="true" />
                          </Link>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {can('asset.read') && (
          <Card>
            <CardHeader
              title="Equipamentos por setor"
              description="Cada equipamento ligado visualmente ao setor onde está."
            />
            <div className="px-2 pb-3">
              {carregandoAtivos ? (
                <SkeletonList rows={4} label="equipamentos" />
              ) : (ativos?.items.length ?? 0) === 0 ? (
                <EmptyState
                  icon={<Boxes className="size-5" />}
                  title="Nenhum equipamento"
                  description="Cadastre o primeiro equipamento escolhendo o setor onde ele está."
                  className="py-6"
                />
              ) : (
                <div className="flex flex-col gap-4">
                  {[
                    ...setores,
                    ...(semSetor.length ? [{ id: 'sem-setor', name: 'Sem setor' } as CustomerLocation] : []),
                  ]
                    .filter((s) => (porSetor.get(s.id) ?? []).length > 0)
                    .map((s) => (
                      <section key={s.id} aria-label={s.name}>
                        <h3
                          className={cn(
                            'flex items-center gap-2 px-2 pb-1 text-xs font-semibold tracking-wide uppercase',
                            s.id === 'sem-setor' ? 'text-warn-text' : 'text-muted'
                          )}
                        >
                          <MapPin className="size-3.5" aria-hidden="true" />
                          {s.name}
                          <span className="font-normal normal-case">
                            · {(porSetor.get(s.id) ?? []).length}
                          </span>
                        </h3>
                        <ul className="rounded-control border border-border-subtle">
                          {(porSetor.get(s.id) ?? []).map((a, i) => (
                            <li key={a.id} className={cn(i > 0 && 'border-t border-border-subtle')}>
                              <Link
                                to="/ativos/$id"
                                params={{ id: a.id }}
                                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-hover"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-text">{a.name}</span>
                                  <span className="block truncate text-xs text-muted">
                                    {[a.category_name, a.manufacturer_name, a.model_name, a.tag]
                                      .filter(Boolean)
                                      .join(' · ')}
                                    {a.location_name && a.location_name !== s.name
                                      ? ` · ${a.location_name}`
                                      : ''}
                                  </span>
                                </span>
                                <StatusChip size="sm" tone={TOM_STATUS_ATIVO[a.status] ?? 'neutral'}>
                                  {ROTULO_STATUS_ATIVO[a.status] ?? a.status}
                                </StatusChip>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {outros.length > 0 && (
          <Card>
            <CardHeader
              title="Unidades e outros locais"
              description="A estrutura acima dos setores (unidade, prédio, andar) e as salas."
            />
            <ul className="px-4 pb-4 text-sm">
              {outros.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-2 py-1"
                  style={{ paddingLeft: (l.depth - 1) * 16 }}
                >
                  <Building2 className="size-3.5 text-subtle" aria-hidden="true" />
                  <span className="text-text">{l.name}</span>
                  <span className="text-xs text-muted">{l.location_type_name}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <DialogoSetor cliente={c} locais={locais} nomeInicial={novoSetor} onClose={() => setNovoSetor(null)} />
      <DialogoRenomear local={renomeando} onClose={() => setRenomeando(null)} />
      <DialogoEquipamento
        open={equipamentoNoSetor !== null}
        onOpenChange={(o) => !o && setEquipamentoNoSetor(null)}
        clienteInicial={c.id}
        setorInicial={equipamentoNoSetor || undefined}
      />
      {editandoCliente && <DialogoEditarCliente cliente={c} onFechar={() => setEditandoCliente(false)} />}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Novo setor: nome livre (o atalho só preenche) e a unidade onde ele fica.
 *
 * Setor não fica na raiz — a escada de tipos o põe sob unidade, prédio ou
 * andar. Cliente sem unidade ganha a unidade no mesmo gesto: um campo a mais,
 * e não uma ida a outra tela.
 */
function DialogoSetor({
  cliente,
  locais,
  nomeInicial,
  onClose,
}: {
  cliente: Customer;
  locais: CustomerLocation[];
  nomeInicial: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const aberto = nomeInicial !== null;
  const [nome, setNome] = useState('');
  const [pai, setPai] = useState('');
  const [novaUnidade, setNovaUnidade] = useState('');
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);
  const [ultimoAberto, setUltimoAberto] = useState<string | null>(null);

  if (aberto && ultimoAberto !== nomeInicial) {
    setUltimoAberto(nomeInicial);
    setNome(nomeInicial ?? '');
    setNovaUnidade('');
    setErro(null);
  }
  if (!aberto && ultimoAberto !== null) setUltimoAberto(null);

  const { data: tipos } = useApiQuery(locationTypesList, undefined, {
    enabled: aberto,
    staleTime: 10 * 60_000,
  }) as {
    data: { items: LocationType[] } | undefined;
  };
  const tipoSetor = tipos?.items.find((t) => t.key === 'setor');
  const tipoRaiz = tipos?.items.find((t) => t.can_be_root);
  const pais = locais.filter((l) => tipoSetor?.allowed_parent_type_ids.includes(l.location_type_id ?? ''));
  const paiEscolhido = pai || (pais.length === 1 ? pais[0]!.id : '');

  const criar = useApiMutation(locationsCreate, {
    invalidates: [customersDetail, customersList],
    onError: (e: ApiError) => setErro({ campo: e.field, mensagem: e.problem.message }),
  });

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!tipoSetor) return setErro({ mensagem: 'Esta organização não tem o tipo de local "Setor".' });
    if (nome.trim().length === 0) return setErro({ campo: 'name', mensagem: 'Dê um nome ao setor.' });
    try {
      let parentId = paiEscolhido;
      if (!parentId) {
        if (pais.length > 0) return setErro({ campo: 'parent_id', mensagem: 'Escolha a unidade do setor.' });
        if (!tipoRaiz) return setErro({ mensagem: 'Não há tipo de local para a unidade.' });
        if (novaUnidade.trim().length === 0) {
          return setErro({ campo: 'unidade', mensagem: 'Dê um nome à unidade onde o setor fica.' });
        }
        const u = (await criar.mutateAsync({
          body: { customer_id: cliente.id, location_type_id: tipoRaiz.id, name: novaUnidade.trim() },
        })) as { id: string };
        parentId = u.id;
      }
      await criar.mutateAsync({
        body: {
          customer_id: cliente.id,
          parent_id: parentId,
          location_type_id: tipoSetor.id,
          name: nome.trim(),
        },
      });
      toast.success('Setor criado', `${nome.trim()} já pode receber equipamentos.`);
      onClose();
    } catch {
      // mensagem já no formulário
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => !o && onClose()}
      title="Novo setor"
      description={`Um setor de ${cliente.name}. O nome é livre.`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="form-setor" variant="primary" loading={criar.isPending}>
            Criar setor
          </Button>
        </>
      }
    >
      <form id="form-setor" onSubmit={salvar} noValidate className="flex flex-col gap-4">
        <Field label="Nome do setor" required error={erro?.campo === 'name' ? erro.mensagem : null}>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: UTI Adulto"
            autoFocus
          />
        </Field>
        {pais.length > 1 && (
          <Field label="Unidade" required error={erro?.campo === 'parent_id' ? erro.mensagem : null}>
            <Select value={pai} onChange={(e) => setPai(e.target.value)}>
              <option value="">Escolha onde o setor fica</option>
              {pais.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.location_type_name ? ` (${p.location_type_name})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {pais.length === 1 && <p className="text-sm text-muted">Fica em: {pais[0]!.name}</p>}
        {pais.length === 0 && (
          <Field
            label="Unidade"
            required
            hint="Este cliente ainda não tem unidade. Ela é criada junto com o setor."
            error={erro?.campo === 'unidade' ? erro.mensagem : null}
          >
            <Input
              value={novaUnidade}
              onChange={(e) => setNovaUnidade(e.target.value)}
              placeholder="Ex.: Unidade Centro"
            />
          </Field>
        )}
        {erro && !['name', 'parent_id', 'unidade'].includes(erro.campo ?? '') && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro.mensagem}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function DialogoRenomear({ local, onClose }: { local: CustomerLocation | null; onClose: () => void }) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [de, setDe] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (local && de !== local.id) {
    setDe(local.id);
    setNome(local.name);
    setErro(null);
  }
  if (!local && de !== null) setDe(null);

  const renomear = useApiMutation(locationsUpdate, {
    invalidates: [customersDetail],
    onError: (e: ApiError) => setErro(e.problem.message),
    onSuccess: () => {
      toast.success('Setor renomeado');
      onClose();
    },
  });

  return (
    <Dialog
      open={local !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Renomear setor"
      description="O nome muda em todas as telas; os equipamentos continuam no setor."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="form-renomear" variant="primary" loading={renomear.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        id="form-renomear"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!local) return;
          if (nome.trim().length === 0) return setErro('Dê um nome ao setor.');
          renomear.mutate({ params: { id: local.id }, body: { name: nome.trim() } });
        }}
      >
        <Field label="Nome" required error={erro}>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
