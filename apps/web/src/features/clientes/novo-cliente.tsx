/**
 * Aurora — o diálogo "Novo cliente", usado em mais de um lugar.
 *
 * UM COMPONENTE, E NÃO DOIS FORMULÁRIOS PARECIDOS.
 *
 * O cliente é cadastrado na tela de clientes e, também, no meio da abertura
 * de uma solicitação — quando o hospital ao telefone ainda não existe no
 * sistema. Dois formulários divergiriam no primeiro campo novo: um pediria
 * CNPJ e o outro não, e a pessoa aprenderia que "depende de onde cadastra".
 *
 * A PRIMEIRA UNIDADE É UM CONVITE, NÃO UM PASSO OBRIGATÓRIO.
 *
 * Depois de salvar, o diálogo oferece registrar a primeira unidade — porque é
 * nela que os ativos vão morar, e um cliente sem unidade é um cliente onde
 * ainda não dá para cadastrar equipamento. Mas oferecer não é exigir: quem
 * está abrindo uma solicitação às pressas fecha e segue.
 */
import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input, Select, cn, useToast } from '@aurora/ui';
import {
  CONTRACT_PROFILES,
  CONTRACT_PROFILE_LABELS,
  contractsList,
  customersCreate,
  customersList,
  locationTypesList,
  locationsCreate,
  type ContractProfile,
  type Customer,
  type LocationType,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';

/**
 * Segmentos sugeridos.
 *
 * O banco guarda texto livre — uma importação pode trazer qualquer coisa —, e
 * por isso a lista fica aqui, na interface, com a chave estável gravada e o
 * rótulo só na tela. Valor que não está na lista aparece como veio.
 */
export const SEGMENTOS = [
  { valor: 'hospital', rotulo: 'Hospital' },
  { valor: 'clinica', rotulo: 'Clínica' },
  { valor: 'laboratorio', rotulo: 'Laboratório' },
  { valor: 'diagnostico_imagem', rotulo: 'Diagnóstico por imagem' },
  { valor: 'home_care', rotulo: 'Home care' },
  { valor: 'outro', rotulo: 'Outro' },
] as const;

export function rotuloDoSegmento(segmento: string | null | undefined): string | null {
  if (!segmento) return null;
  return SEGMENTOS.find((s) => s.valor === segmento)?.rotulo ?? segmento;
}

interface Erro {
  campo?: string;
  mensagem: string;
}

export interface DialogoNovoClienteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado assim que o cliente é gravado — antes da oferta de unidade. */
  onCriado?: (cliente: Customer) => void;
  /**
   * Oferece registrar a primeira unidade depois de salvar. Desligado no meio
   * de outro formulário: lá a pessoa quer voltar ao que estava fazendo.
   */
  oferecerUnidade?: boolean;
}

export function DialogoNovoCliente({
  open,
  onOpenChange,
  onCriado,
  oferecerUnidade = false,
}: DialogoNovoClienteProps) {
  const toast = useToast();
  const { can } = usePermissions();

  const [nome, setNome] = useState('');
  const [fantasia, setFantasia] = useState('');
  const [documento, setDocumento] = useState('');
  const [codigo, setCodigo] = useState('');
  const [segmento, setSegmento] = useState('');
  /*
   * "Possui contrato?" começa em NÃO: um contrato só nasce quando alguém o
   * declara. Com Sim, o tipo é obrigatório — e o contrato é criado de verdade,
   * em rascunho, para ser completado em Contratos.
   */
  const [possuiContrato, setPossuiContrato] = useState(false);
  const [perfil, setPerfil] = useState<ContractProfile | ''>('');
  const [erro, setErro] = useState<Erro | null>(null);

  /** Preenchido depois de salvar: o diálogo passa a oferecer a unidade. */
  const [criado, setCriado] = useState<Customer | null>(null);
  const [unidade, setUnidade] = useState('');

  const podeCriarUnidade = oferecerUnidade && can('location.create', 'location.read');
  // Declarar o contrato cria um contrato: a pergunta só aparece para quem pode.
  const podeDeclararContrato = can('contract.create');

  // Só busca os tipos quando vai precisar deles — quem não pode criar local
  // não deve pagar uma ida ao servidor que termina em 403.
  const { data: tipos } = useApiQuery(locationTypesList, undefined, {
    enabled: open && podeCriarUnidade,
    staleTime: 10 * 60_000,
  }) as { data: { items: LocationType[] } | undefined };
  const tipoUnidade = tipos?.items.find((t) => t.key === 'unidade' && t.can_be_root);

  const criar = useApiMutation(customersCreate, {
    invalidates: [customersList, contractsList],
    onError: (e: ApiError) => setErro({ campo: e.field, mensagem: e.problem.message }),
  });

  const criarUnidade = useApiMutation(locationsCreate, {
    invalidates: [customersList],
    onError: (e: ApiError) =>
      setErro({ campo: e.field === 'name' ? 'unidade' : e.field, mensagem: e.problem.message }),
  });

  function limpar() {
    setNome('');
    setFantasia('');
    setDocumento('');
    setCodigo('');
    setSegmento('');
    setPossuiContrato(false);
    setPerfil('');
    setErro(null);
    setCriado(null);
    setUnidade('');
  }

  function fechar() {
    limpar();
    onOpenChange(false);
  }

  function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim().length < 2) {
      setErro({ campo: 'name', mensagem: 'Informe o nome do cliente — o hospital, a clínica ou a rede.' });
      return;
    }
    const comContrato = podeDeclararContrato && possuiContrato;
    if (comContrato && !perfil) {
      setErro({
        campo: 'contract_profile',
        mensagem: 'Escolha o tipo de contrato: Básico, Completo ou Expert.',
      });
      return;
    }
    criar.mutate(
      {
        body: {
          name: nome.trim(),
          // Campo vazio não vai: "não informado" é ausência, e não texto vazio.
          trade_name: fantasia.trim() || undefined,
          tax_id: documento.trim() || undefined,
          code: codigo.trim() || undefined,
          segment: segmento || undefined,
          ...(comContrato && perfil ? { has_contract: true, contract_profile: perfil } : {}),
        },
      },
      {
        onSuccess: (c) => {
          const cliente = c as Customer;
          onCriado?.(cliente);
          if (podeCriarUnidade && tipoUnidade) {
            setCriado(cliente);
            return;
          }
          toast.success('Cliente cadastrado', `${cliente.name} já pode receber solicitações.`);
          fechar();
        },
      }
    );
  }

  function salvarUnidade(e: FormEvent) {
    e.preventDefault();
    if (!criado || !tipoUnidade) return;
    setErro(null);
    if (unidade.trim().length === 0) {
      setErro({ campo: 'unidade', mensagem: 'Dê um nome à unidade, ou escolha "Agora não".' });
      return;
    }
    criarUnidade.mutate(
      {
        body: { customer_id: criado.id, location_type_id: tipoUnidade.id, name: unidade.trim() },
      },
      {
        onSuccess: () => {
          toast.success(
            'Cliente e unidade cadastrados',
            `A unidade ${unidade.trim()} já pode receber setores, salas e equipamentos.`
          );
          fechar();
        },
      }
    );
  }

  const erroDe = (campo: string) => (erro?.campo === campo ? erro.mensagem : null);
  const erroSolto =
    erro &&
    !['name', 'trade_name', 'tax_id', 'code', 'segment', 'contract_profile', 'unidade'].includes(
      erro.campo ?? ''
    );

  if (criado) {
    return (
      <Dialog
        open={open}
        onOpenChange={(o) => (o ? onOpenChange(true) : fechar())}
        title="Cliente cadastrado"
        description={`Quer já registrar a primeira unidade de ${criado.name}? É nela que os equipamentos vão ficar.`}
        footer={
          <>
            <Button
              onClick={() => {
                toast.success('Cliente cadastrado', 'As unidades podem ser registradas depois.');
                fechar();
              }}
            >
              Agora não
            </Button>
            <Button
              type="submit"
              form="form-primeira-unidade"
              variant="primary"
              loading={criarUnidade.isPending}
            >
              Criar unidade
            </Button>
          </>
        }
      >
        <form id="form-primeira-unidade" onSubmit={salvarUnidade} noValidate className="flex flex-col gap-4">
          <Field
            label="Nome da unidade"
            required
            error={erroDe('unidade')}
            hint="O prédio, o campus ou a filial. Setores e salas entram depois, dentro dela."
          >
            <Input
              value={unidade}
              onChange={(e) => {
                setUnidade(e.target.value);
                setErro(null);
              }}
              placeholder="Ex.: Unidade Centro"
              autoFocus
            />
          </Field>
          {erroSolto && (
            <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
              {erro.mensagem}
            </p>
          )}
        </form>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : fechar())}
      title="Novo cliente"
      description="O hospital, a clínica ou a unidade que você atende. Ativos, solicitações e contratos ficam pendurados nele."
      footer={
        <>
          <Button onClick={fechar}>Cancelar</Button>
          <Button type="submit" form="form-novo-cliente" variant="primary" loading={criar.isPending}>
            Cadastrar cliente
          </Button>
        </>
      }
    >
      {/* `noValidate`: a validação que vale é a nossa, com a mensagem no campo. */}
      <form id="form-novo-cliente" onSubmit={salvar} noValidate className="flex flex-col gap-4">
        <Field
          label="Nome"
          required
          error={erroDe('name')}
          hint="A razão social ou o nome pelo qual a equipe o conhece."
        >
          <Input
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
              setErro(null);
            }}
            placeholder="Ex.: Hospital São Lucas"
            autoFocus
          />
        </Field>

        <Field label="Nome fantasia" error={erroDe('trade_name')}>
          <Input
            value={fantasia}
            onChange={(e) => {
              setFantasia(e.target.value);
              setErro(null);
            }}
            placeholder="Opcional"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CNPJ" error={erroDe('tax_id')} hint="Com ou sem pontuação.">
            <Input
              value={documento}
              inputMode="numeric"
              onChange={(e) => {
                setDocumento(e.target.value);
                setErro(null);
              }}
              placeholder="00.000.000/0000-00"
            />
          </Field>

          <Field label="Código" error={erroDe('code')} hint="O código que vocês já usam, se houver.">
            <Input
              value={codigo}
              onChange={(e) => {
                setCodigo(e.target.value);
                setErro(null);
              }}
              placeholder="Opcional"
            />
          </Field>
        </div>

        <Field label="Segmento" error={erroDe('segment')}>
          <Select value={segmento} onChange={(e) => setSegmento(e.target.value)}>
            <option value="">Não informar</option>
            {SEGMENTOS.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.rotulo}
              </option>
            ))}
          </Select>
        </Field>

        {podeDeclararContrato && (
          <>
            <PossuiContrato
              valor={possuiContrato}
              onChange={(v) => {
                setPossuiContrato(v);
                if (!v) setPerfil('');
                setErro(null);
              }}
            />
            {possuiContrato && (
              <Field
                label="Tipo de contrato"
                required
                error={erroDe('contract_profile')}
                hint="O contrato entra em rascunho: vigência e cobertura se completam em Contratos."
              >
                <Select
                  value={perfil}
                  onChange={(e) => {
                    setPerfil(e.target.value as ContractProfile | '');
                    setErro(null);
                  }}
                >
                  <option value="">Escolha o tipo</option>
                  {CONTRACT_PROFILES.map((p) => (
                    <option key={p} value={p}>
                      {CONTRACT_PROFILE_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}

        {erroSolto && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro.mensagem}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/**
 * "Possui contrato?" — Sim ou Não, lado a lado.
 *
 * Rádios de verdade por baixo, e não dois botões: a pergunta tem exatamente
 * uma resposta, e o leitor de tela precisa anunciá-la como escolha única.
 */
function PossuiContrato({ valor, onChange }: { valor: boolean; onChange: (v: boolean) => void }) {
  const opcoes = [
    { v: true, rotulo: 'Sim' },
    { v: false, rotulo: 'Não' },
  ];
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-text">Possui contrato?</legend>
      <div className="grid grid-cols-2 gap-1 rounded-control border border-border p-0.5 sm:w-56">
        {opcoes.map((o) => (
          <label
            key={o.rotulo}
            className={cn(
              'flex min-h-8 cursor-pointer items-center justify-center rounded-control px-3 text-sm transition-colors',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent',
              valor === o.v
                ? 'bg-accent-soft font-semibold text-accent-text'
                : 'font-medium text-muted hover:bg-surface-hover hover:text-text'
            )}
          >
            <input
              type="radio"
              name="possui-contrato"
              className="aurora-sr-only"
              checked={valor === o.v}
              onChange={() => onChange(o.v)}
            />
            {o.rotulo}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
