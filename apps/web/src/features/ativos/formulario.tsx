/**
 * Aurora — cadastrar e editar equipamento: Cliente → Setor → Equipamento.
 *
 * CLIENTE E SETOR SÃO OS DOIS PRIMEIROS CAMPOS, E SÃO OBRIGATÓRIOS.
 *
 * O equipamento sempre mora num setor de um cliente — é por eles que a
 * preventiva o alcança, que o hospital o enxerga e que o painel o conta. Ao
 * escolher o cliente, a lista de setores passa a ser SÓ a dele; ao trocar de
 * cliente, o setor escolhido é descartado. E o servidor confere tudo de novo:
 * esta tela organiza a escolha, não a garante.
 *
 * NA EDIÇÃO, MUDAR DE SETOR É TRANSFERÊNCIA.
 *
 * O banco recusa a edição direta do local (0015) — mudar de lugar exige
 * motivo, e fica na linha do tempo do equipamento. O formulário mostra isso
 * em vez de esconder: trocar o setor abre o campo de motivo.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Dialog, Field, Input, Select, useToast } from '@aurora/ui';
import {
  assetDetail,
  assetsCreate,
  assetsFormOptions,
  assetsList,
  assetsTransfer,
  assetsUpdate,
  customersDetail,
  customersList,
  type Customer,
  type CustomerLocation,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';

interface Opcoes {
  categories: Array<{ id: string; name: string }>;
  models: Array<{
    id: string;
    name: string;
    manufacturer_name: string | null;
    asset_category_id: string | null;
  }>;
  criticalities: Array<{ id: string; name: string }>;
}

export interface EquipamentoInicial {
  id: string;
  name: string;
  customer_id: string;
  location_id: string | null;
  asset_category_id: string;
  asset_model_id: string | null;
  criticality_id: string | null;
  tag: string | null;
  serial_number: string | null;
  asset_number: string | null;
}

export interface DialogoEquipamentoProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ausente: cadastro novo. Presente: edição. */
  inicial?: EquipamentoInicial;
  /** Vindo da ficha do cliente/setor: já começa preenchido. */
  clienteInicial?: string;
  setorInicial?: string;
}

/** Locais que recebem equipamento: setores e salas (pela regra do tipo). */
export function locaisQueRecebem(locais: CustomerLocation[]): CustomerLocation[] {
  return locais.filter((l) =>
    l.allows_assets === undefined
      ? l.location_type_key === 'setor' || l.location_type_key === 'sala'
      : l.allows_assets
  );
}

/** "UTI" ou "UTI › Leito 3": a sala diz em que setor está. */
export function nomeComPai(l: CustomerLocation, todos: CustomerLocation[]): string {
  if (l.location_type_key !== 'sala') return l.name;
  const pai = todos.find((p) => p.id === l.parent_id);
  return pai ? `${pai.name} › ${l.name}` : l.name;
}

export function DialogoEquipamento({
  open,
  onOpenChange,
  inicial,
  clienteInicial,
  setorInicial,
}: DialogoEquipamentoProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const editando = Boolean(inicial);

  const [cliente, setCliente] = useState(inicial?.customer_id ?? clienteInicial ?? '');
  const [setor, setSetor] = useState(inicial?.location_id ?? setorInicial ?? '');
  const [nome, setNome] = useState(inicial?.name ?? '');
  const [categoria, setCategoria] = useState(inicial?.asset_category_id ?? '');
  const [modelo, setModelo] = useState(inicial?.asset_model_id ?? '');
  const [criticidade, setCriticidade] = useState(inicial?.criticality_id ?? '');
  const [tag, setTag] = useState(inicial?.tag ?? '');
  const [serie, setSerie] = useState(inicial?.serial_number ?? '');
  const [patrimonio, setPatrimonio] = useState(inicial?.asset_number ?? '');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);

  // Reabrir o diálogo recomeça do estado de quem abriu.
  useEffect(() => {
    if (!open) return;
    setCliente(inicial?.customer_id ?? clienteInicial ?? '');
    setSetor(inicial?.location_id ?? setorInicial ?? '');
    setNome(inicial?.name ?? '');
    setCategoria(inicial?.asset_category_id ?? '');
    setModelo(inicial?.asset_model_id ?? '');
    setCriticidade(inicial?.criticality_id ?? '');
    setTag(inicial?.tag ?? '');
    setSerie(inicial?.serial_number ?? '');
    setPatrimonio(inicial?.asset_number ?? '');
    setMotivo('');
    setErro(null);
  }, [open, inicial, clienteInicial, setorInicial]);

  const { data: clientes } = useApiQuery(customersList, undefined, { enabled: open }) as {
    data: { items: Customer[] } | undefined;
  };
  const { data: detalhe, isLoading: carregandoSetores } = useApiQuery(
    customersDetail,
    { params: { id: cliente } },
    { enabled: open && Boolean(cliente) }
  ) as { data: { locations: CustomerLocation[] } | undefined; isLoading: boolean };
  const { data: opcoes } = useApiQuery(assetsFormOptions, undefined, {
    enabled: open,
    staleTime: 5 * 60_000,
  }) as {
    data: Opcoes | undefined;
  };

  const todosLocais = useMemo(() => detalhe?.locations ?? [], [detalhe]);
  const setores = useMemo(() => locaisQueRecebem(todosLocais), [todosLocais]);
  const modelos = useMemo(
    () =>
      (opcoes?.models ?? []).filter(
        (m) => !categoria || !m.asset_category_id || m.asset_category_id === categoria
      ),
    [opcoes, categoria]
  );
  const mudouDeSetor = editando && setor !== (inicial?.location_id ?? '');

  const aoErrar = (e: ApiError) => setErro({ campo: e.field, mensagem: e.problem.message });
  const criar = useApiMutation(assetsCreate, {
    invalidates: [assetsList, customersDetail, customersList],
    onError: aoErrar,
  });
  const editar = useApiMutation(assetsUpdate, {
    invalidates: [assetsList, assetDetail, customersDetail],
    onError: aoErrar,
  });
  const transferir = useApiMutation(assetsTransfer, {
    invalidates: [assetsList, assetDetail, customersDetail],
    onError: aoErrar,
  });

  function validar(): boolean {
    if (!cliente) return falhar('customer_id', 'Escolha o cliente (hospital) do equipamento.');
    if (!setor) return falhar('location_id', 'Escolha o setor onde o equipamento está.');
    if (nome.trim().length < 2) return falhar('name', 'Dê um nome ao equipamento.');
    if (!categoria) return falhar('asset_category_id', 'Escolha a categoria.');
    if (mudouDeSetor && motivo.trim().length < 5)
      return falhar('reason', 'Mudar de setor exige um motivo (5+ letras).');
    return true;
  }
  function falhar(campo: string, mensagem: string): false {
    setErro({ campo, mensagem });
    return false;
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!validar()) return;
    const campos = {
      name: nome.trim(),
      asset_category_id: categoria,
      asset_model_id: modelo || null,
      criticality_id: criticidade || null,
      tag: tag.trim() || null,
      serial_number: serie.trim() || null,
      asset_number: patrimonio.trim() || null,
    };
    try {
      if (!editando) {
        const r = (await criar.mutateAsync({
          body: { ...campos, customer_id: cliente, location_id: setor },
        })) as { id: string };
        toast.success('Equipamento cadastrado', `${campos.name} já está no setor.`);
        onOpenChange(false);
        void navigate({ to: '/ativos/$id', params: { id: r.id } });
        return;
      }
      await editar.mutateAsync({ params: { id: inicial!.id }, body: campos });
      if (mudouDeSetor) {
        await transferir.mutateAsync({
          params: { id: inicial!.id },
          body: { to_location_id: setor, reason: motivo.trim() },
        });
      }
      toast.success(
        'Equipamento atualizado',
        mudouDeSetor ? 'A transferência ficou registrada na linha do tempo.' : undefined
      );
      onOpenChange(false);
    } catch {
      // A mensagem já está no formulário (onError).
    }
  }

  const erroDe = (c: string) => (erro?.campo === c ? erro.mensagem : null);
  const conhecidos = ['customer_id', 'location_id', 'name', 'asset_category_id', 'reason'];
  const salvando = criar.isPending || editar.isPending || transferir.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editando ? 'Editar equipamento' : 'Novo equipamento'}
      description={
        editando
          ? 'Dados cadastrais do equipamento. Mudar de setor é uma transferência, com motivo.'
          : 'Primeiro onde ele está — cliente e setor —, depois o que ele é.'
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="form-equipamento" variant="primary" loading={salvando}>
            {editando ? 'Salvar alterações' : 'Cadastrar equipamento'}
          </Button>
        </>
      }
    >
      <form id="form-equipamento" onSubmit={salvar} noValidate className="flex flex-col gap-5">
        <fieldset className="grid gap-4 rounded-card border border-border-subtle bg-surface-subtle p-4 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">Onde está</legend>
          <Field label="Cliente / Hospital" required error={erroDe('customer_id')}>
            <Select
              value={cliente}
              disabled={editando}
              onChange={(e) => {
                setCliente(e.target.value);
                // Setor é sempre DE um cliente: trocar o cliente descarta o setor.
                setSetor('');
                setErro(null);
              }}
            >
              <option value="">Escolha o cliente</option>
              {(clientes?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Setor"
            required
            error={erroDe('location_id')}
            hint={
              cliente && !carregandoSetores && setores.length === 0
                ? 'Este cliente ainda não tem setor. Crie em Clientes › Setores.'
                : undefined
            }
          >
            <Select
              value={setor}
              disabled={!cliente || (editando && !can('asset.transfer'))}
              onChange={(e) => {
                setSetor(e.target.value);
                setErro(null);
              }}
            >
              <option value="">{cliente ? 'Escolha o setor' : 'Escolha o cliente primeiro'}</option>
              {setores.map((s) => (
                <option key={s.id} value={s.id}>
                  {nomeComPai(s, todosLocais)}
                </option>
              ))}
            </Select>
          </Field>
          {mudouDeSetor && (
            <Field
              label="Motivo da transferência"
              required
              error={erroDe('reason')}
              className="sm:col-span-2"
              hint="Fica na linha do tempo do equipamento."
            >
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: remanejado para o Bloco Cirúrgico"
              />
            </Field>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do equipamento" required error={erroDe('name')} className="sm:col-span-2">
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Monitor multiparamétrico — leito 3"
            />
          </Field>
          <Field label="Categoria" required error={erroDe('asset_category_id')}>
            <Select
              value={categoria}
              onChange={(e) => {
                setCategoria(e.target.value);
                setModelo('');
              }}
            >
              <option value="">Escolha a categoria</option>
              {(opcoes?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Modelo" error={erroDe('asset_model_id')}>
            <Select value={modelo} onChange={(e) => setModelo(e.target.value)}>
              <option value="">Não informar</option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.manufacturer_name ? `${m.manufacturer_name} — ${m.name}` : m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Criticidade" error={erroDe('criticality_id')}>
            <Select value={criticidade} onChange={(e) => setCriticidade(e.target.value)}>
              <option value="">Não informar</option>
              {(opcoes?.criticalities ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tag" error={erroDe('tag')}>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Opcional" />
          </Field>
          <Field label="Número de série" error={erroDe('serial_number')}>
            <Input value={serie} onChange={(e) => setSerie(e.target.value)} placeholder="Opcional" />
          </Field>
          <Field label="Patrimônio" error={erroDe('asset_number')}>
            <Input
              value={patrimonio}
              onChange={(e) => setPatrimonio(e.target.value)}
              placeholder="Opcional"
            />
          </Field>
        </div>

        {erro && !conhecidos.includes(erro.campo ?? '') && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro.mensagem}
          </p>
        )}
      </form>
    </Dialog>
  );
}
