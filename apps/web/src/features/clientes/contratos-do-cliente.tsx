/**
 * Aurora — os contratos DENTRO do cadastro do cliente (Anderson, 10/11/2026 — CTR-01..08).
 *
 * Não é cadastro novo: é o MÓDULO DE CONTRATOS (Comercial › Contratos) trazido para a ficha do
 * cliente. Criar aqui grava em `aurora.contracts`, com a cobertura "todos os equipamentos do
 * cliente" — é ela que faz o SLA GERAL valer para cada equipamento. O SLA POR EQUIPAMENTO é a
 * exceção, opcional, configurada na ficha do equipamento; a tela diz qual é qual.
 *
 * Três conceitos separados: modalidade de atendimento (+ equipes fixas), base de precificação e
 * condição de pagamento. Todos são cadastro — nenhum gera cobrança, fatura ou apuração.
 *
 * O relatório incluso e a vigência informada no cadastro (CLI-05/06) continuam aqui, como antes.
 */
import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { FileSignature, Pencil, Plus } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonList,
  StatusChip,
  Textarea,
  cn,
  useToast,
} from '@aurora/ui';
import {
  BILLING_MODELS,
  CONTRACT_KINDS,
  FIXED_TEAM_PACKAGES,
  PAYMENT_TERMS,
  SERVICE_FREQUENCIES,
  contractDetail,
  contractsCreate,
  contractsList,
  contractsOptions,
  contractsUpdate,
  type BillingModel,
  type ContractRow,
  type ContractStatus,
  type Customer,
  type PaymentTerms,
  type ServiceFrequency,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { ROTULO_DO_RELATORIO, SeloDoContrato, periodoDoContrato } from './contrato';
import { ROTULO_CONTRATO } from '../planos/novo-plano';
import { formatarData } from '../comercial/orcamentos';
import {
  ROTULO_MODALIDADE,
  ROTULO_PAGAMENTO,
  ROTULO_PRECIFICACAO,
  rotuloDasEquipes,
} from '../comercial/rotulos-contrato';

const SITUACAO: Record<
  ContractStatus,
  { rotulo: string; tom: 'neutral' | 'info' | 'warn' | 'good' | 'bad' }
> = {
  draft: { rotulo: 'Rascunho', tom: 'neutral' },
  active: { rotulo: 'Vigente', tom: 'good' },
  suspended: { rotulo: 'Suspenso', tom: 'warn' },
  expired: { rotulo: 'Expirado', tom: 'warn' },
  terminated: { rotulo: 'Encerrado', tom: 'neutral' },
};

export function ContratosDoCliente({ cliente }: { cliente: Customer }) {
  const [dialogo, setDialogo] = useState<{ contrato: ContractRow | null } | null>(null);
  const { data, isLoading } = useApiQuery(contractsList, { query: { customerId: cliente.id } });
  const contratos = data?.items ?? [];

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FileSignature className="size-4 text-accent-text" aria-hidden="true" />
            Contratos
          </span>
        }
        description="O contrato do módulo comercial, aqui no cadastro: vigência, SLA geral, modalidade e condições."
        actions={
          <Can permission="contract.create">
            <Button
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => setDialogo({ contrato: null })}
            >
              Novo contrato
            </Button>
          </Can>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-4">
        {/* CLI-05/06: o relatório incluso e a vigência informada no cadastro, como antes. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-control bg-surface-sunken px-3 py-2 text-sm">
          <span className="text-muted">
            Relatório incluso:{' '}
            <span className="text-text">
              {cliente.report_tier ? ROTULO_DO_RELATORIO[cliente.report_tier] : 'não informado'}
            </span>
          </span>
          <span className="text-muted" data-numeric>
            Vigência no cadastro:{' '}
            <span className="text-text">{periodoDoContrato(cliente) ?? 'não informada'}</span>
          </span>
          <SeloDoContrato cliente={cliente} size="md" />
        </div>

        {isLoading ? (
          <SkeletonList rows={2} label="Carregando os contratos" />
        ) : contratos.length === 0 ? (
          <EmptyState
            icon={<FileSignature className="size-5" />}
            title="Nenhum contrato no módulo"
            description="Sem contrato, o SLA dos equipamentos segue o padrão do cliente ou da organização, como antes."
            className="py-4"
          />
        ) : (
          <ul className="flex flex-col">
            {contratos.map((c, i) => (
              <LinhaDoContrato
                key={c.id}
                contrato={c}
                primeira={i === 0}
                onEditar={() => setDialogo({ contrato: c })}
              />
            ))}
          </ul>
        )}
      </div>
      {dialogo && (
        <DialogoContrato cliente={cliente} contrato={dialogo.contrato} onFechar={() => setDialogo(null)} />
      )}
    </Card>
  );
}

function LinhaDoContrato({
  contrato: c,
  primeira,
  onEditar,
}: {
  contrato: ContractRow;
  primeira: boolean;
  onEditar: () => void;
}) {
  const s = SITUACAO[c.status];
  const editavel = c.status !== 'terminated' && c.status !== 'expired';
  const equipes = rotuloDasEquipes(c.fixed_team_packages);
  return (
    <li
      className={cn(
        'flex flex-col gap-2 py-3 sm:flex-row sm:items-start',
        !primeira && 'border-t border-border-subtle'
      )}
      data-testid={`contrato-${c.number}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/contratos/$id" params={{ id: c.id }} className="font-medium text-text hover:underline">
            {c.number}
          </Link>
          {c.title && <span className="truncate text-sm text-muted">{c.title}</span>}
          <StatusChip tone={s.tom} size="sm">
            {s.rotulo}
          </StatusChip>
        </div>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Par
            rotulo="Vigência"
            valor={`${formatarData(c.starts_on)} → ${c.ends_on ? formatarData(c.ends_on) : 'sem fim'}`}
          />
          <Par rotulo="Natureza" valor={ROTULO_CONTRATO[c.kind] ?? c.kind} />
          <Par
            rotulo="SLA geral"
            valor={
              c.sla_policy_name
                ? `${c.sla_policy_name}${c.covers_all_assets ? ' · todos os equipamentos' : ''}`
                : 'Não definido — vale o padrão do cliente/organização'
            }
          />
          <Par
            rotulo="Atendimento"
            valor={
              [c.service_frequency ? ROTULO_MODALIDADE[c.service_frequency] : null, equipes]
                .filter(Boolean)
                .join(' · ') || 'Não informado'
            }
          />
          <Par
            rotulo="Precificação"
            valor={ROTULO_PRECIFICACAO[c.billing_model as BillingModel] ?? c.billing_model}
          />
          <Par
            rotulo="Pagamento"
            valor={c.payment_terms ? ROTULO_PAGAMENTO[c.payment_terms] : 'Não informado'}
          />
        </dl>
      </div>
      {editavel && (
        <Can permission="contract.update">
          <Button
            size="sm"
            icon={<Pencil className="size-4" />}
            onClick={onEditar}
            aria-label={`Editar ${c.number}`}
          >
            Editar
          </Button>
        </Can>
      )}
    </li>
  );
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted">{rotulo}:</dt>
      <dd className="min-w-0 text-text">{valor}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* criar / editar                                                              */
/* -------------------------------------------------------------------------- */

export function DialogoContrato({
  cliente,
  contrato,
  onFechar,
}: {
  cliente: Pick<Customer, 'id' | 'name' | 'contract_starts_on' | 'contract_ends_on'>;
  /** Nulo = novo contrato. */
  contrato: ContractRow | null;
  onFechar: () => void;
}) {
  const toast = useToast();
  const novo = contrato === null;
  const { data: opcoes } = useApiQuery(contractsOptions, {});
  const politicas = opcoes?.sla_policies ?? [];

  const [natureza, setNatureza] = useState<string>(contrato?.kind ?? 'full_service');
  const [titulo, setTitulo] = useState(contrato?.title ?? '');
  // O novo contrato aproveita a vigência já informada no cadastro do cliente (CLI-06).
  const [inicio, setInicio] = useState(contrato?.starts_on ?? cliente.contract_starts_on ?? '');
  const [fim, setFim] = useState(contrato ? (contrato.ends_on ?? '') : (cliente.contract_ends_on ?? ''));
  const [sla, setSla] = useState(contrato?.sla_policy_id ?? '');
  const [modalidade, setModalidade] = useState<string>(contrato?.service_frequency ?? '');
  const [equipes, setEquipes] = useState<number[]>(contrato?.fixed_team_packages ?? []);
  const [precificacao, setPrecificacao] = useState<string>(contrato?.billing_model ?? 'fixed_monthly');
  const [pagamento, setPagamento] = useState<string>(contrato?.payment_terms ?? '');
  const [observacoes, setObservacoes] = useState('');
  const [cobreTudo, setCobreTudo] = useState(true);
  const [ativar, setAtivar] = useState(true);
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);

  const aoErrar = (e: ApiError) => setErro({ campo: e.field, mensagem: e.problem.message });
  const criar = useApiMutation(contractsCreate, { invalidates: [contractsList], onError: aoErrar });
  const editar = useApiMutation(contractsUpdate, {
    invalidates: [contractsList, contractDetail],
    onError: aoErrar,
  });

  const podeMudarInicio = novo || contrato?.status === 'draft';

  function alternarEquipe(n: number) {
    setEquipes((atual) =>
      atual.includes(n) ? atual.filter((x) => x !== n) : [...atual, n].sort((a, b) => a - b)
    );
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!inicio) {
      setErro({ campo: 'startsOn', mensagem: 'Informe o início da vigência.' });
      return;
    }
    if (fim && fim < inicio) {
      setErro({ campo: 'endsOn', mensagem: 'O fim não pode ser antes do início.' });
      return;
    }
    const comum = {
      title: titulo.trim() || null,
      endsOn: fim || null,
      slaPolicyId: sla || null,
      serviceFrequency: (modalidade || null) as ServiceFrequency | null,
      fixedTeamPackages: equipes.length > 0 ? equipes : null,
      billingModel: precificacao as BillingModel,
      paymentTerms: (pagamento || null) as PaymentTerms | null,
      // Observações só na criação: a edição não as recebe e por isso não as apaga.
      ...(novo && observacoes.trim() ? { notes: observacoes.trim() } : {}),
    };
    const ok = (msg: string) => () => {
      toast.success(msg);
      onFechar();
    };
    if (novo) {
      criar.mutate(
        {
          body: {
            customerId: cliente.id,
            kind: natureza as (typeof CONTRACT_KINDS)[number],
            startsOn: inicio,
            ...comum,
            coverAllAssets: cobreTudo,
            activate: cobreTudo && ativar,
          },
        },
        { onSuccess: ok('Contrato criado') }
      );
    } else {
      editar.mutate(
        {
          params: { id: contrato.id },
          body: {
            ...comum,
            ...(podeMudarInicio && inicio !== contrato.starts_on ? { startsOn: inicio } : {}),
          },
        },
        { onSuccess: ok('Contrato atualizado') }
      );
    }
  }

  const erroDe = (c: string) => (erro?.campo === c ? erro.mensagem : null);
  const conhecidos = [
    'startsOn',
    'endsOn',
    'slaPolicyId',
    'serviceFrequency',
    'fixedTeamPackages',
    'paymentTerms',
  ];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={novo ? `Novo contrato — ${cliente.name}` : `Editar ${contrato.number}`}
      description="Vigência, SLA geral, modalidade de atendimento e condições comerciais cadastrais. Nada aqui gera cobrança."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            type="submit"
            form="form-contrato"
            variant="primary"
            loading={criar.isPending || editar.isPending}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="form-contrato" onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {novo && (
            <Field label="Natureza do contrato" required>
              <Select value={natureza} onChange={(e) => setNatureza(e.target.value)}>
                {CONTRACT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ROTULO_CONTRATO[k] ?? k}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Título" hint="Opcional. O número é gerado pelo sistema.">
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </Field>
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-text">Vigência</legend>
          <Field
            label="Início"
            required
            error={erroDe('startsOn')}
            hint={podeMudarInicio ? undefined : 'Só muda com o contrato em rascunho.'}
          >
            <Input
              type="date"
              value={inicio}
              disabled={!podeMudarInicio}
              onChange={(e) => setInicio(e.target.value)}
            />
          </Field>
          <Field label="Fim" error={erroDe('endsOn')} hint="Vazio = sem data de término.">
            <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
          </Field>
        </fieldset>

        <Field
          label="SLA geral do contrato"
          error={erroDe('slaPolicyId')}
          hint="Vale para todos os equipamentos cobertos. O SLA específico de um equipamento é exceção opcional, na ficha dele."
        >
          <Select value={sla} onChange={(e) => setSla(e.target.value)}>
            <option value="">Sem SLA geral — vale o padrão do cliente ou da organização</option>
            {politicas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.is_default ? ' (padrão da organização)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold text-text">Modalidade de atendimento</legend>
          <Field label="Periodicidade das visitas" error={erroDe('serviceFrequency')}>
            <Select value={modalidade} onChange={(e) => setModalidade(e.target.value)}>
              <option value="">Não informada</option>
              {SERVICE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_MODALIDADE[f]}
                </option>
              ))}
            </Select>
          </Field>
          <div role="group" aria-label="Equipes fixas" className="flex flex-col gap-1.5">
            <span className="text-sm text-text">Equipe fixa</span>
            <span className="text-xs text-muted">
              Pode combinar mais de uma. O número identifica o pacote; a composição de cada um ainda não está
              definida.
            </span>
            <div className="flex flex-wrap gap-2">
              {FIXED_TEAM_PACKAGES.map((n) => (
                <label
                  key={n}
                  className={cn(
                    'inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm',
                    equipes.includes(n)
                      ? 'border-accent bg-accent-soft text-accent-text'
                      : 'border-border-strong text-muted'
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={equipes.includes(n)}
                    onChange={() => alternarEquipe(n)}
                  />
                  Equipe Fixa {n}
                </label>
              ))}
            </div>
            {erroDe('fixedTeamPackages') && (
              <p className="text-sm text-bad-text">{erroDe('fixedTeamPackages')}</p>
            )}
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-text">Condições comerciais (só cadastro)</legend>
          <Field label="Base de precificação" hint="Como o valor é calculado. Não gera cobrança.">
            <Select value={precificacao} onChange={(e) => setPrecificacao(e.target.value)}>
              {BILLING_MODELS.map((b) => (
                <option key={b} value={b}>
                  {ROTULO_PRECIFICACAO[b]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Condição de pagamento" error={erroDe('paymentTerms')}>
            <Select value={pagamento} onChange={(e) => setPagamento(e.target.value)}>
              <option value="">Não informada</option>
              {PAYMENT_TERMS.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PAGAMENTO[p]}
                </option>
              ))}
            </Select>
          </Field>
        </fieldset>

        {novo && (
          <Field label="Observações">
            <Textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </Field>
        )}

        {novo && (
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={cobreTudo}
                onChange={(e) => setCobreTudo(e.target.checked)}
              />
              <span>
                Cobre todos os equipamentos do cliente
                <span className="block text-xs text-muted">
                  É o que faz o SLA geral valer para cada equipamento. Sem cobertura o contrato não protege
                  nenhum e não pode ser ativado.
                </span>
              </span>
            </label>
            <label className={cn('flex items-center gap-2', !cobreTudo && 'opacity-50')}>
              <input
                type="checkbox"
                className="size-4"
                checked={cobreTudo && ativar}
                disabled={!cobreTudo}
                onChange={(e) => setAtivar(e.target.checked)}
              />
              Ativar agora (senão fica em rascunho)
            </label>
          </div>
        )}

        {erro && !conhecidos.includes(erro.campo ?? '') && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro.mensagem}
          </p>
        )}
      </form>
    </Dialog>
  );
}
