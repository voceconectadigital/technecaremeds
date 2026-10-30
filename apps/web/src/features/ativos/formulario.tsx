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
 * FAMÍLIA → NOME DO CATÁLOGO → MODELO (reunião 16/10/2026; ATV-08, 19/10/2026).
 *
 * O cliente pediu para tirar o "Tipo do equipamento" da tela — e, na reunião,
 * nomes padronizados. As duas coisas cabem juntas: o NOME do equipamento é
 * escolhido do catálogo da família (Suporte à vida, Diagnóstico, Terapia,
 * Tratamento, Equipamentos de apoio), e o vínculo com o tipo do catálogo é
 * gravado por baixo, derivado do nome escolhido. Nome que não está no catálogo
 * não salva; quem cura o catálogo cadastra o nome novo ali mesmo. O que
 * diferencia um ventilador do outro é a tag, a série e o patrimônio — não um
 * nome livre que cada pessoa escreve de um jeito.
 *
 * O cadastro antigo, de nome livre, continua editável: mantido o nome e a
 * família, o vínculo de antes fica como estava.
 *
 * FOTO OBRIGATÓRIA NO CADASTRO (ATV-07). Sem foto o formulário não salva, e a
 * API também recusa: a foto vai no mesmo corpo do cadastro, e o equipamento e
 * a foto nascem juntos. Na edição a foto é opcional — escolher um arquivo troca
 * a foto (e dá foto ao parque cadastrado antes da exigência).
 *
 * SLA DO EQUIPAMENTO (ATV-15). Liga/desliga e, ligado, a política própria (ou
 * a herdada do contrato, do cliente ou da organização). Desligado, nenhuma OS
 * nem chamado deste equipamento abre relógio de SLA — quem decide é o banco.
 *
 * NA EDIÇÃO, MUDAR DE SETOR É TRANSFERÊNCIA.
 *
 * O banco recusa a edição direta do local (0015) — mudar de lugar exige
 * motivo, e fica na linha do tempo do equipamento. O formulário mostra isso
 * em vez de esconder: trocar o setor abre o campo de motivo.
 */
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Dialog, Field, Input, Select, useFieldControl, useToast } from '@aurora/ui';
import {
  assetCategoriesCreate,
  assetModelsCreate,
  assetDetail,
  assetPhoto,
  assetPhotoUpload,
  assetsCreate,
  assetsFormOptions,
  assetsList,
  assetsTransfer,
  assetsUpdate,
  customersDetail,
  customersList,
  ASSET_PHOTO_CONTENT_TYPES,
  MAX_ASSET_PHOTO_BYTES,
  type AssetPhotoInput,
  type Customer,
  type CustomerLocation,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';

interface Opcoes {
  categories: Array<{ id: string; name: string; parent_id: string | null; family_key?: string | null }>;
  models: Array<{
    id: string;
    name: string;
    manufacturer_name: string | null;
    asset_category_id: string | null;
  }>;
  criticalities: Array<{ id: string; name: string }>;
  sla_policies?: Array<{ id: string; name: string; is_default: boolean }>;
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
  tracker_kind?: string | null;
  tracker_tag?: string | null;
  anvisa_registration?: string | null;
  acquired_at?: string | null;
  useful_life_years?: number | null;
  /** Só chegam do servidor para quem tem `asset.read_financials`. */
  purchase_value?: string | null;
  acquisition_invoice?: string | null;
  /** SLA do equipamento (0085). Ausente = habilitado, herdando a política. */
  sla_enabled?: boolean;
  sla_policy_id?: string | null;
  /** Se o equipamento já tem foto (o parque antigo pode não ter). */
  tem_foto?: boolean;
}

/** "1.500,00" ou "1500.00" → 1500. Vazio → null; texto que não é número → NaN. */
export function valorEmReais(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

/** Nome comparável: sem acento, sem caixa, sem espaço sobrando. "Ventilador  Pulmonar" = "ventilador pulmonar". */
export function nomeComparavel(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** O tipo do catálogo cujo nome é este (comparação sem acento nem caixa), se houver. */
export function tipoPeloNome<T extends { name: string }>(nome: string, tipos: readonly T[]): T | null {
  const alvo = nomeComparavel(nome);
  if (!alvo) return null;
  return tipos.find((t) => nomeComparavel(t.name) === alvo) ?? null;
}

/** O arquivo em base64 puro (sem o prefixo `data:`), como a API recebe. */
export async function arquivoEmBase64(arquivo: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(leitor.error ?? new Error('não foi possível ler o arquivo'));
    leitor.readAsDataURL(arquivo);
  });
  return url.slice(url.indexOf(',') + 1);
}

/** Confere a foto escolhida antes de qualquer envio. `null` = serve. */
export function problemaDaFoto(arquivo: { type: string; size: number }): string | null {
  if (!(ASSET_PHOTO_CONTENT_TYPES as readonly string[]).includes(arquivo.type)) {
    return 'A foto precisa ser PNG, JPEG ou WebP.';
  }
  if (arquivo.size > MAX_ASSET_PHOTO_BYTES) return 'A foto passa de 8 MB. Use uma foto menor.';
  return null;
}

export const TIPOS_DE_RASTREADOR = [
  { valor: 'gps', rotulo: 'Chip geolocalizador (GPS)' },
  { valor: 'ble', rotulo: 'Beacon Bluetooth (BLE)' },
  { valor: 'rfid', rotulo: 'Etiqueta RFID' },
  { valor: 'nfc', rotulo: 'Etiqueta NFC' },
  { valor: 'outro', rotulo: 'Outro' },
] as const;

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

/** O campo de arquivo da foto, ligado ao rótulo do `Field` (clicar no rótulo abre a escolha). */
function CampoDaFoto({ onEscolher }: { onEscolher: (arquivo: File | null) => void }) {
  const campo = useFieldControl();
  return (
    <input
      {...campo}
      type="file"
      accept={ASSET_PHOTO_CONTENT_TYPES.join(',')}
      onChange={(e) => onEscolher(e.target.files?.[0] ?? null)}
      className="text-sm text-text file:mr-3 file:rounded-control file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm"
    />
  );
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
  const idDaLista = `${useId()}-catalogo`;

  const [cliente, setCliente] = useState(inicial?.customer_id ?? clienteInicial ?? '');
  const [setor, setSetor] = useState(inicial?.location_id ?? setorInicial ?? '');
  const [nome, setNome] = useState(inicial?.name ?? '');
  const [modelo, setModelo] = useState(inicial?.asset_model_id ?? '');
  const [criticidade, setCriticidade] = useState(inicial?.criticality_id ?? '');
  const [tag, setTag] = useState(inicial?.tag ?? '');
  const [serie, setSerie] = useState(inicial?.serial_number ?? '');
  const [patrimonio, setPatrimonio] = useState(inicial?.asset_number ?? '');
  const [familia, setFamilia] = useState('');
  const [rastreadorTipo, setRastreadorTipo] = useState(inicial?.tracker_kind ?? '');
  const [rastreadorId, setRastreadorId] = useState(inicial?.tracker_tag ?? '');
  const [anvisa, setAnvisa] = useState(inicial?.anvisa_registration ?? '');
  const [adquiridoEm, setAdquiridoEm] = useState(inicial?.acquired_at?.slice(0, 10) ?? '');
  const [vidaUtil, setVidaUtil] = useState(
    inicial?.useful_life_years ? String(inicial.useful_life_years) : ''
  );
  const [valorBem, setValorBem] = useState(inicial?.purchase_value ?? '');
  const [notaFiscal, setNotaFiscal] = useState(inicial?.acquisition_invoice ?? '');
  const [slaHabilitado, setSlaHabilitado] = useState(inicial?.sla_enabled ?? true);
  const [politicaSla, setPoliticaSla] = useState(inicial?.sla_policy_id ?? '');
  const [foto, setFoto] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  /** O tipo recém-criado no catálogo, até a lista recarregada chegar. */
  const [tipoCriado, setTipoCriado] = useState<{ id: string; name: string; parent_id: string } | null>(null);
  const [novoModelo, setNovoModelo] = useState<{ fabricante: string; nome: string } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);

  // Reabrir o diálogo recomeça do estado de quem abriu.
  useEffect(() => {
    if (!open) return;
    setCliente(inicial?.customer_id ?? clienteInicial ?? '');
    setSetor(inicial?.location_id ?? setorInicial ?? '');
    setNome(inicial?.name ?? '');
    setModelo(inicial?.asset_model_id ?? '');
    setCriticidade(inicial?.criticality_id ?? '');
    setTag(inicial?.tag ?? '');
    setSerie(inicial?.serial_number ?? '');
    setPatrimonio(inicial?.asset_number ?? '');
    setFamilia('');
    setRastreadorTipo(inicial?.tracker_kind ?? '');
    setRastreadorId(inicial?.tracker_tag ?? '');
    setAnvisa(inicial?.anvisa_registration ?? '');
    setAdquiridoEm(inicial?.acquired_at?.slice(0, 10) ?? '');
    setVidaUtil(inicial?.useful_life_years ? String(inicial.useful_life_years) : '');
    setValorBem(inicial?.purchase_value ?? '');
    setNotaFiscal(inicial?.acquisition_invoice ?? '');
    setSlaHabilitado(inicial?.sla_enabled ?? true);
    setPoliticaSla(inicial?.sla_policy_id ?? '');
    setFoto(null);
    setTipoCriado(null);
    setNovoModelo(null);
    setMotivo('');
    setErro(null);
  }, [open, inicial, clienteInicial, setorInicial]);

  // A prévia da foto escolhida, liberada quando troca ou o diálogo fecha.
  useEffect(() => {
    if (!foto) {
      setPrevia(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

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

  const categorias = useMemo(() => opcoes?.categories ?? [], [opcoes]);
  const familias = useMemo(() => categorias.filter((c) => c.family_key), [categorias]);
  /** A família de uma categoria: a própria, se for família; senão, a do pai (ou "sem família"). */
  const familiaDe = useMemo(
    () => (categoriaId: string | null | undefined) => {
      const c = categorias.find((x) => x.id === categoriaId);
      if (!c) return '';
      if (c.family_key) return c.id;
      const pai = categorias.find((x) => x.id === c.parent_id && x.family_key);
      return pai ? pai.id : 'sem-familia';
    },
    [categorias]
  );
  const familiaInicial = familiaDe(inicial?.asset_category_id);
  const familiaEfetiva = familia || familiaInicial;
  const nomeDaFamilia = familias.find((f) => f.id === familiaEfetiva)?.name ?? null;
  const tipos = useMemo(() => {
    const daFamilia =
      familiaEfetiva === 'sem-familia'
        ? categorias.filter(
            (c) => !c.family_key && !categorias.some((f) => f.id === c.parent_id && f.family_key)
          )
        : categorias.filter((c) => c.parent_id === familiaEfetiva);
    // O recém-criado entra já, sem esperar a lista recarregar.
    return tipoCriado &&
      tipoCriado.parent_id === familiaEfetiva &&
      !daFamilia.some((c) => c.id === tipoCriado.id)
      ? [...daFamilia, { ...tipoCriado, family_key: null }]
      : daFamilia;
  }, [categorias, familiaEfetiva, tipoCriado]);

  /*
   * O vínculo de tipo é DERIVADO do nome: o nome escolhido do catálogo É o tipo. No cadastro
   * antigo (nome livre), mantidos o nome e a família, o vínculo de antes continua.
   */
  const tipoDoNome = tipoPeloNome(nome, tipos);
  const mantemLegado =
    editando && nome.trim() === (inicial?.name ?? '').trim() && familiaEfetiva === familiaInicial;
  const categoria = tipoDoNome?.id ?? (mantemLegado ? inicial!.asset_category_id : '');

  const podeCurar = can('organization.manage_catalogs');
  const podeVerFinanceiro = can('asset.read_financials');
  const criarTipo = useApiMutation(assetCategoriesCreate, {
    invalidates: [assetsFormOptions],
    onError: (e: ApiError) => setErro({ campo: 'name', mensagem: e.problem.message }),
  });
  const criarModelo = useApiMutation(assetModelsCreate, {
    invalidates: [assetsFormOptions],
    onError: (e: ApiError) => setErro({ campo: 'asset_model_id', mensagem: e.problem.message }),
  });

  const todosLocais = useMemo(() => detalhe?.locations ?? [], [detalhe]);
  const setores = useMemo(() => locaisQueRecebem(todosLocais), [todosLocais]);
  const modelos = useMemo(
    () =>
      (opcoes?.models ?? []).filter(
        (m) => !categoria || !m.asset_category_id || m.asset_category_id === categoria
      ),
    [opcoes, categoria]
  );
  // Trocou o nome (e, com ele, o tipo): o modelo de outro tipo deixa de valer.
  useEffect(() => {
    if (modelo && opcoes && !modelos.some((m) => m.id === modelo)) setModelo('');
  }, [modelo, modelos, opcoes]);
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
  const enviarFoto = useApiMutation(assetPhotoUpload, {
    invalidates: [assetDetail, assetPhoto],
    onError: aoErrar,
  });
  const transferir = useApiMutation(assetsTransfer, {
    invalidates: [assetsList, assetDetail, customersDetail],
    onError: aoErrar,
  });

  function validar(): boolean {
    if (!cliente) return falhar('customer_id', 'Escolha o cliente (hospital) do equipamento.');
    if (!setor) return falhar('location_id', 'Escolha o setor onde o equipamento está.');
    if (!familiaEfetiva) return falhar('name', 'Escolha a família e depois o nome do equipamento.');
    if (nome.trim().length < 2) return falhar('name', 'Escolha o nome do equipamento no catálogo.');
    if (!categoria)
      return falhar(
        'name',
        podeCurar
          ? 'Este nome não está no catálogo da família: escolha um da lista ou cadastre-o no catálogo.'
          : 'Este nome não está no catálogo da família: escolha um da lista.'
      );
    if (!tag.trim()) return falhar('tag', 'A tag é obrigatória: é ela que identifica o equipamento.');
    if (!editando && !foto) return falhar('photo', 'A foto do equipamento é obrigatória no cadastro.');
    if (foto) {
      const problema = problemaDaFoto(foto);
      if (problema) return falhar('photo', problema);
    }
    if (
      vidaUtil.trim() &&
      !(Number.isInteger(Number(vidaUtil)) && Number(vidaUtil) >= 1 && Number(vidaUtil) <= 100)
    )
      return falhar('useful_life_years', 'A vida útil é um número inteiro de anos, de 1 a 100.');
    if (podeVerFinanceiro && Number.isNaN(valorEmReais(valorBem)))
      return falhar('purchase_value', 'Valor inválido. Use números, por exemplo 1.500,00.');
    if (Boolean(rastreadorTipo) !== Boolean(rastreadorId.trim()))
      return falhar('tracker_tag', 'Informe o tipo e o identificador do chip juntos (ou nenhum).');
    if (mudouDeSetor && motivo.trim().length < 5)
      return falhar('reason', 'Mudar de setor exige um motivo (5+ letras).');
    return true;
  }
  function falhar(campo: string, mensagem: string): false {
    setErro({ campo, mensagem });
    return false;
  }

  async function fotoParaEnvio(arquivo: File): Promise<AssetPhotoInput> {
    return {
      content_type: arquivo.type as AssetPhotoInput['content_type'],
      data_base64: await arquivoEmBase64(arquivo),
    };
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!validar()) return;
    const campos = {
      // O nome padronizado é o do catálogo, escrito como lá (e não como foi digitado).
      name: tipoDoNome ? tipoDoNome.name : nome.trim(),
      asset_category_id: categoria,
      asset_model_id: modelo || null,
      criticality_id: criticidade || null,
      tag: tag.trim() || null,
      serial_number: serie.trim() || null,
      asset_number: patrimonio.trim() || null,
      tracker_kind: (rastreadorTipo || null) as (typeof TIPOS_DE_RASTREADOR)[number]['valor'] | null,
      tracker_tag: rastreadorId.trim() || null,
      anvisa_registration: anvisa.trim() || null,
      acquired_at: adquiridoEm || null,
      useful_life_years: vidaUtil.trim() ? Number(vidaUtil) : null,
      sla_enabled: slaHabilitado,
      // Desligado, a política escolhida fica guardada (e é ignorada): não vai no corpo.
      ...(slaHabilitado ? { sla_policy_id: politicaSla || null } : {}),
      // Valor e nota fiscal são dado financeiro: só vão quem tem permissão (a API recusa o resto).
      ...(podeVerFinanceiro
        ? { purchase_value: valorEmReais(valorBem), acquisition_invoice: notaFiscal.trim() || null }
        : {}),
    };
    try {
      if (!editando) {
        const r = (await criar.mutateAsync({
          body: {
            ...campos,
            customer_id: cliente,
            location_id: setor,
            photo: await fotoParaEnvio(foto!),
          },
        })) as { id: string };
        toast.success('Equipamento cadastrado', `${campos.name} já está no setor.`);
        onOpenChange(false);
        void navigate({ to: '/ativos/$id', params: { id: r.id } });
        return;
      }
      await editar.mutateAsync({ params: { id: inicial!.id }, body: campos });
      if (foto) {
        await enviarFoto.mutateAsync({
          params: { id: inicial!.id },
          body: { photo: await fotoParaEnvio(foto) },
        });
      }
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
  const conhecidos = [
    'customer_id',
    'location_id',
    'name',
    'asset_category_id',
    'asset_model_id',
    'tracker_tag',
    'tracker_kind',
    'reason',
    'tag',
    'photo',
    'useful_life_years',
    'purchase_value',
    'sla_policy_id',
  ];
  const salvando = criar.isPending || editar.isPending || enviarFoto.isPending || transferir.isPending;
  const nomeForaDoCatalogo = nome.trim().length >= 2 && !categoria && Boolean(familiaEfetiva);
  const politicas = opcoes?.sla_policies ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editando ? 'Editar equipamento' : 'Novo equipamento'}
      description={
        editando
          ? 'Dados cadastrais do equipamento. Mudar de setor é uma transferência, com motivo.'
          : 'Primeiro onde ele está — cliente e setor —, depois o que ele é, e a foto.'
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
          <Field label="Família" hint="A categoria do equipamento.">
            <Select
              value={familiaEfetiva}
              onChange={(e) => {
                setFamilia(e.target.value);
                setModelo('');
              }}
            >
              <option value="">Escolha a família</option>
              {familias.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value="sem-familia">Nomes sem família (cadastro antigo)</option>
            </Select>
          </Field>
          <Field
            label="Nome do equipamento"
            required
            error={erroDe('name') ?? erroDe('asset_category_id')}
            hint={
              !familiaEfetiva
                ? undefined
                : tipos.length === 0
                  ? 'Nenhum nome no catálogo desta família ainda.'
                  : 'Escolha da lista do catálogo da família: o nome é padronizado.'
            }
          >
            <Input
              value={nome}
              list={idDaLista}
              disabled={!familiaEfetiva}
              autoComplete="off"
              onChange={(e) => {
                setNome(e.target.value);
                if (erro?.campo === 'name') setErro(null);
              }}
              placeholder={familiaEfetiva ? 'Ex.: Ventilador pulmonar' : 'Escolha a família primeiro'}
            />
          </Field>
          <datalist id={idDaLista}>
            {tipos.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          {nomeForaDoCatalogo && (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              {podeCurar && familiaEfetiva !== 'sem-familia' ? (
                <Button
                  size="sm"
                  loading={criarTipo.isPending}
                  onClick={() => {
                    const novo = nome.trim();
                    criarTipo.mutate(
                      { body: { name: novo, family_id: familiaEfetiva } },
                      {
                        onSuccess: (r) =>
                          setTipoCriado({
                            id: (r as { id: string }).id,
                            name: novo,
                            parent_id: familiaEfetiva,
                          }),
                      }
                    );
                  }}
                >
                  {`Cadastrar “${nome.trim()}” no catálogo${nomeDaFamilia ? ` de ${nomeDaFamilia}` : ''}`}
                </Button>
              ) : (
                <p className="text-xs text-muted">
                  Este nome não está no catálogo desta família. Escolha um da lista — ou peça a quem cuida do
                  catálogo para cadastrá-lo.
                </p>
              )}
            </div>
          )}
          <Field label="Modelo (fabricante — modelo)" error={erroDe('asset_model_id')}>
            <Select value={modelo} onChange={(e) => setModelo(e.target.value)}>
              <option value="">Não informar</option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.manufacturer_name ? `${m.manufacturer_name} — ${m.name}` : m.name}
                </option>
              ))}
            </Select>
          </Field>
          {podeCurar && categoria && (
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
              {novoModelo === null ? (
                <Button size="sm" onClick={() => setNovoModelo({ fabricante: '', nome: '' })}>
                  Novo modelo deste equipamento
                </Button>
              ) : (
                <>
                  <Field label="Fabricante" className="min-w-40 flex-1">
                    <Input
                      value={novoModelo.fabricante}
                      onChange={(e) => setNovoModelo({ ...novoModelo, fabricante: e.target.value })}
                    />
                  </Field>
                  <Field label="Modelo" className="min-w-40 flex-1">
                    <Input
                      value={novoModelo.nome}
                      onChange={(e) => setNovoModelo({ ...novoModelo, nome: e.target.value })}
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={criarModelo.isPending}
                    onClick={() =>
                      criarModelo.mutate(
                        {
                          body: {
                            manufacturer: novoModelo.fabricante.trim(),
                            name: novoModelo.nome.trim(),
                            asset_category_id: categoria,
                          },
                        },
                        {
                          onSuccess: (r) => {
                            setModelo((r as { id: string }).id);
                            setNovoModelo(null);
                          },
                        }
                      )
                    }
                  >
                    Criar modelo
                  </Button>
                </>
              )}
            </div>
          )}
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
          <Field label="Tag (obrigatória)" error={erroDe('tag')}>
            <Input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              required
              aria-required="true"
              placeholder="Ex.: UTI-VM-014"
            />
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

        <fieldset className="grid gap-4 rounded-card border border-border-subtle p-4 sm:grid-cols-[1fr_auto]">
          <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
            Foto do equipamento
          </legend>
          <Field
            label="Foto do equipamento"
            required={!editando}
            error={erroDe('photo')}
            hint={
              editando
                ? inicial?.tem_foto
                  ? 'Escolha um arquivo só se quiser trocar a foto. PNG, JPEG ou WebP, até 8 MB.'
                  : 'Este equipamento ainda não tem foto. PNG, JPEG ou WebP, até 8 MB.'
                : 'Obrigatória no cadastro. PNG, JPEG ou WebP, até 8 MB.'
            }
          >
            <CampoDaFoto
              onEscolher={(arquivo) => {
                setFoto(arquivo);
                // Tipo e tamanho são conferidos na escolha: a pessoa sabe na hora, não ao salvar.
                const problema = arquivo ? problemaDaFoto(arquivo) : null;
                setErro(problema ? { campo: 'photo', mensagem: problema } : null);
              }}
            />
          </Field>
          {previa && (
            <img
              src={previa}
              alt="Prévia da foto do equipamento"
              className="size-24 rounded-card border border-border-subtle object-cover"
            />
          )}
        </fieldset>

        <fieldset className="grid gap-4 rounded-card border border-border-subtle p-4 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
            SLA deste equipamento
          </legend>
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-text sm:col-span-2">
            <input
              type="checkbox"
              checked={slaHabilitado}
              onChange={(e) => setSlaHabilitado(e.target.checked)}
              className="size-4"
            />
            SLA deste equipamento habilitado
          </label>
          {slaHabilitado ? (
            <Field
              label="Política de SLA"
              error={erroDe('sla_policy_id')}
              className="sm:col-span-2"
              hint="Sem política própria, vale a do contrato, a do cliente ou a da organização."
            >
              <Select value={politicaSla} onChange={(e) => setPoliticaSla(e.target.value)}>
                <option value="">Herdar (contrato, cliente ou organização)</option>
                {politicas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.is_default ? `${p.name} (padrão)` : p.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="rounded-control bg-surface-sunken px-3 py-2 text-sm text-muted sm:col-span-2">
              Desabilitado: as OS e os chamados deste equipamento não abrem relógio de SLA.
            </p>
          )}
        </fieldset>

        <fieldset className="grid gap-4 rounded-card border border-border-subtle p-4 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
            Aquisição e registro
          </legend>
          <Field label="Registro ANVISA" error={erroDe('anvisa_registration')}>
            <Input value={anvisa} onChange={(e) => setAnvisa(e.target.value)} placeholder="Opcional" />
          </Field>
          <Field label="Data de aquisição" error={erroDe('acquired_at')}>
            <Input type="date" value={adquiridoEm} onChange={(e) => setAdquiridoEm(e.target.value)} />
          </Field>
          <Field
            label="Durabilidade (anos)"
            error={erroDe('useful_life_years')}
            hint="A depreciação conta a partir da data de aquisição, em linha reta, por este prazo."
          >
            <Input
              inputMode="numeric"
              value={vidaUtil}
              onChange={(e) => setVidaUtil(e.target.value)}
              placeholder="Ex.: 10"
            />
          </Field>
          {podeVerFinanceiro && (
            <>
              <Field label="Valor do bem (R$)" error={erroDe('purchase_value')}>
                <Input
                  inputMode="decimal"
                  value={valorBem}
                  onChange={(e) => setValorBem(e.target.value)}
                  placeholder="Ex.: 25.000,00"
                />
              </Field>
              <Field label="Nota fiscal de aquisição">
                <Input
                  value={notaFiscal}
                  onChange={(e) => setNotaFiscal(e.target.value)}
                  placeholder="Número da NF"
                />
              </Field>
            </>
          )}
        </fieldset>

        <fieldset className="grid gap-4 rounded-card border border-border-subtle p-4 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
            Chip geolocalizador / etiqueta de localização
          </legend>
          <Field label="Tipo de identificação" error={erroDe('tracker_kind')}>
            <Select value={rastreadorTipo} onChange={(e) => setRastreadorTipo(e.target.value)}>
              <option value="">Nenhum</option>
              {TIPOS_DE_RASTREADOR.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Identificador do chip"
            error={erroDe('tracker_tag')}
            hint="Só o vínculo: a leitura do chip depende de hardware ainda não integrado."
          >
            <Input
              value={rastreadorId}
              onChange={(e) => setRastreadorId(e.target.value)}
              placeholder="Opcional"
            />
          </Field>
        </fieldset>

        {erro && !conhecidos.includes(erro.campo ?? '') && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro.mensagem}
          </p>
        )}
      </form>
    </Dialog>
  );
}
