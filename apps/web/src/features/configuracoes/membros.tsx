/**
 * Aurora — USUÁRIOS da organização (reunião 16/10/2026, Fase 1).
 *
 * "Adicionar usuário" cria pessoa, vínculo, escopo e papel numa transação só.
 * Três decisões desta tela, e por quê:
 *
 *   · PERFIL DE ACESSO (Operador, Solicitante, Gestor) é a primeira escolha. É
 *     a forma comercial de escolher um papel do RBAC — não um segundo sistema.
 *     Os papéis finos continuam na gaveta "Ver acesso".
 *   · PROFISSÃO é cadastro. Escrever "Engenheiro" não concede nada; quem
 *     precisa de mais acesso recebe papel ou permissão, com motivo.
 *   · ESCOPO (cliente → setores) é parte do formulário, não um passo depois:
 *     quem entra sem escopo vê uma tela vazia e não distingue isso de falta de
 *     permissão. O servidor aplica o escopo; a tela só o escolhe.
 */
import { useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  Cog,
  HeartPulse,
  Plus,
  ShoppingCart,
  Stethoscope,
  Trash2,
  User,
  UserPlus,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  Avatar,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Menu,
  Select,
  SkeletonList,
  StatusChip,
  Textarea,
  cn,
  useToast,
} from '@aurora/ui';
import {
  customersDetail,
  customersList,
  membersDetail,
  membersInvite,
  membersList,
  membersSetStatus,
  membersUpdate,
  type Customer,
  type CustomerLocation,
  type Member,
  type MemberDetail,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery, usePermissions, MARCA } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { GavetaDeAcesso } from './acesso';
import { iconeDaProfissao, type IconeDeProfissao } from './profissao';
import { AlternadorDeConfiguracoes } from './alternador';

/* -------------------------------------------------------------------------- */
/* Vocabulário (espelha packages/domain/src/profiles.ts)                       */
/* -------------------------------------------------------------------------- */

const PERFIS = [
  {
    key: 'operator',
    rotulo: 'Operador',
    papel: 'operator',
    descricao: 'Executa a operação técnica: atende ordens, preenche procedimentos e usa peças.',
  },
  {
    key: 'requester',
    rotulo: 'Solicitante',
    papel: 'requester',
    descricao: 'Abre e acompanha solicitações do seu escopo, avalia o atendimento e aprova orçamento.',
  },
  {
    key: 'manager',
    rotulo: 'Gestor',
    papel: 'manager',
    descricao: 'Visão ampliada dentro do próprio escopo: estoque, orçamentos, indicadores e usuários.',
  },
] as const;
type PerfilKey = (typeof PERFIS)[number]['key'];

const PROFISSOES = [
  'Médico(a)',
  'Enfermeiro(a)',
  'Técnico(a) de enfermagem',
  'Auxiliar de enfermagem',
  'Engenheiro(a)',
  'Técnico(a)',
  'Comprador(a)',
  'Gerente',
  'Diretor(a)',
  'Empresário(a)',
];

const TIPOS_DE_REGISTRO = ['CRM', 'COREN', 'CREA', 'CFT', 'CREFITO', 'OAB', 'OUTRO'] as const;
type TipoDeRegistro = (typeof TIPOS_DE_REGISTRO)[number];

const SITUACAO: Record<string, { rotulo: string; tom: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  active: { rotulo: 'Ativo', tom: 'good' },
  invited: { rotulo: 'Convidado', tom: 'neutral' },
  suspended: { rotulo: 'Suspenso', tom: 'warn' },
  blocked: { rotulo: 'Bloqueado', tom: 'bad' },
  removed: { rotulo: 'Removido', tom: 'neutral' },
};

const PAPEIS: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  manager: 'Gestor',
  operator: 'Operador',
  maintenance_manager: 'Gestor de manutenção',
  coordinator: 'Coordenador',
  technician: 'Técnico (papel antigo)',
  metrologist: 'Metrologista',
  storekeeper: 'Almoxarife',
  finance: 'Financeiro',
  auditor: 'Auditor',
  requester: 'Solicitante',
  customer_manager: 'Gestor do cliente',
};

function rotuloDoPapel(chave: string): string {
  return PAPEIS[chave] ?? chave;
}

interface Registro {
  kind: TipoDeRegistro;
  number: string;
  region: string;
}

/* -------------------------------------------------------------------------- */

const ICONES_DE_PROFISSAO: Record<IconeDeProfissao, { Icone: LucideIcon; rotulo: string }> = {
  doctor: { Icone: Stethoscope, rotulo: 'Médico(a)' },
  nurse: { Icone: HeartPulse, rotulo: 'Enfermagem' },
  engineer: { Icone: Cog, rotulo: 'Engenharia' },
  technician: { Icone: Wrench, rotulo: 'Técnico(a)' },
  buyer: { Icone: ShoppingCart, rotulo: 'Compras' },
  manager: { Icone: Briefcase, rotulo: 'Gestão' },
  executive: { Icone: Building2, rotulo: 'Direção' },
  person: { Icone: User, rotulo: 'Profissão não informada' },
};

/** O selo da profissão sobre o avatar. Só mostra quando a profissão foi informada. */
function IconeDeProfissao({ titulo }: { titulo: string | null }) {
  if (!titulo?.trim()) return null;
  const { Icone, rotulo } = ICONES_DE_PROFISSAO[iconeDaProfissao(titulo)];
  return (
    <span
      title={`${rotulo}: ${titulo}`}
      className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border border-card-border bg-surface text-accent-text"
    >
      <Icone aria-hidden="true" className="size-3" />
      <span className="sr-only">{rotulo}</span>
    </span>
  );
}

export function MembrosPage() {
  const [adicionando, setAdicionando] = useState(false);
  const [mudandoSituacao, setMudandoSituacao] = useState<{ membro: Member; para: Situacao } | null>(null);
  const [vendoAcesso, setVendoAcesso] = useState<Member | null>(null);
  const [editando, setEditando] = useState<Member | null>(null);
  const { can } = usePermissions();

  const { data, isLoading, isError, error } = useApiQuery(membersList) as {
    data: { items: Member[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  if (isError) return <ErrorScreen error={error} />;

  const membros = data?.items ?? [];

  return (
    <AppShell
      title="Usuários"
      subtitle="Quem tem acesso a esta organização, com que perfil e sobre quais clientes e setores."
      breadcrumbs={[{ label: 'Usuários' }]}
      actions={
        <Can permission="organization.manage_members">
          <Button
            variant="primary"
            icon={<UserPlus className="size-4" />}
            onClick={() => setAdicionando(true)}
          >
            Adicionar usuário
          </Button>
        </Can>
      }
    >
      <div className="mb-4">
        <AlternadorDeConfiguracoes />
      </div>

      <Card>
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={5} label="usuários" />
          </div>
        ) : membros.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="Ninguém além de você"
            description="Adicione quem trabalha com você, escolhendo o perfil e o que cada pessoa enxerga."
            action={
              <Button variant="primary" onClick={() => setAdicionando(true)}>
                Adicionar o primeiro usuário
              </Button>
            }
          />
        ) : (
          <ul aria-label="Usuários">
            {membros.map((m, i) => {
              const situacao = SITUACAO[m.status] ?? SITUACAO.active!;
              const nome = m.name || m.email;
              return (
                <li
                  key={m.membership_id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 px-4 py-3',
                    i > 0 && 'border-t border-border-subtle'
                  )}
                >
                  <span className="relative">
                    <Avatar name={nome} />
                    <IconeDeProfissao titulo={m.job_title} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base text-text">
                      {nome}
                      {m.is_owner && (
                        <StatusChip tone="accent" size="sm" withoutDot className="ml-2">
                          Proprietário
                        </StatusChip>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[m.email, m.job_title, m.company_name].filter(Boolean).join(' · ')}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {m.roles.length === 0 ? (
                      <StatusChip
                        tone="warn"
                        size="sm"
                        hint="Sem papel, a pessoa entra e não consegue fazer nada"
                      >
                        Sem perfil
                      </StatusChip>
                    ) : (
                      m.roles.map((r) => (
                        <StatusChip key={r} tone="neutral" size="sm" withoutDot>
                          {rotuloDoPapel(r)}
                        </StatusChip>
                      ))
                    )}
                    <StatusChip tone={situacao.tom} size="sm">
                      {situacao.rotulo}
                    </StatusChip>
                  </div>

                  {can('organization.manage_members') && (
                    <Menu
                      label={`Ações para ${nome}`}
                      trigger={
                        <Button aria-label={`Ações para ${nome}`} variant="ghost" size="sm">
                          ⋯
                        </Button>
                      }
                      items={itensDoMenu(m, {
                        editar: () => setEditando(m),
                        acesso: () => setVendoAcesso(m),
                        situacao: (para) => setMudandoSituacao({ membro: m, para }),
                      })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {vendoAcesso && <GavetaDeAcesso membro={vendoAcesso} onFechar={() => setVendoAcesso(null)} />}
      <DialogoAdicionar open={adicionando} onOpenChange={setAdicionando} />
      {editando && <DialogoCadastro membro={editando} onFechar={() => setEditando(null)} />}
      {mudandoSituacao && (
        <DialogoSituacao
          membro={mudandoSituacao.membro}
          para={mudandoSituacao.para}
          onFechar={() => setMudandoSituacao(null)}
        />
      )}
    </AppShell>
  );
}

type Situacao = 'active' | 'suspended' | 'blocked';

function itensDoMenu(
  m: Member,
  acoes: { editar: () => void; acesso: () => void; situacao: (para: Situacao) => void }
) {
  const dono = m.is_owner;
  const motivoDono = 'O proprietário não pode ser suspenso nem bloqueado: transfira a titularidade antes.';
  const itens: {
    label: string;
    onSelect: () => void;
    destructive?: boolean;
    disabled?: boolean;
    disabledReason?: string;
  }[] = [
    { label: 'Ver e editar cadastro', onSelect: acoes.editar },
    // Responder "por que essa pessoa não consegue?" antes de mexer evita o
    // papel a mais concedido "para destravar".
    { label: 'Ver acesso e permissões', onSelect: acoes.acesso },
  ];
  if (m.status === 'active') {
    itens.push(
      {
        label: 'Suspender acesso',
        destructive: true,
        onSelect: () => acoes.situacao('suspended'),
        disabled: dono,
        disabledReason: motivoDono,
      },
      {
        label: 'Bloquear acesso',
        destructive: true,
        onSelect: () => acoes.situacao('blocked'),
        disabled: dono,
        disabledReason: motivoDono,
      }
    );
  } else if (m.status === 'suspended') {
    itens.push(
      { label: 'Reativar acesso', onSelect: () => acoes.situacao('active') },
      { label: 'Bloquear acesso', destructive: true, onSelect: () => acoes.situacao('blocked') }
    );
  } else if (m.status === 'blocked') {
    itens.push({ label: 'Desbloquear acesso', onSelect: () => acoes.situacao('active') });
  }
  return itens;
}

/* -------------------------------------------------------------------------- */
/* Adicionar usuário                                                          */
/* -------------------------------------------------------------------------- */

function DialogoAdicionar({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const [perfil, setPerfil] = useState<PerfilKey>('operator');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [profissao, setProfissao] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [setores, setSetores] = useState<string[]>([]);
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);

  const adicionar = useApiMutation(membersInvite, {
    invalidates: [membersList],
    onError: (e: ApiError) => setErro({ campo: e.field, mensagem: e.problem.message }),
  });

  function limpar() {
    setPerfil('operator');
    setNome('');
    setEmail('');
    setCpf('');
    setTelefone('');
    setProfissao('');
    setEmpresa('');
    setRegistros([]);
    setClienteId('');
    setSetores([]);
    setErro(null);
  }

  function enviar() {
    const body: Record<string, unknown> = {
      email,
      name: nome,
      profile: perfil,
      cpf: cpf || null,
      phone: telefone || null,
      job_title: profissao || null,
      company_name: empresa || null,
      registrations: registros
        .filter((r) => r.number.trim())
        .map((r) => ({ kind: r.kind, number: r.number, region: r.region || null })),
    };
    if (clienteId) {
      body.customer_scope = 'listed';
      body.customer_ids = [clienteId];
      if (setores.length > 0) {
        body.location_scope = 'listed';
        body.location_ids = setores;
      }
    }
    adicionar.mutate(
      { body: body as never },
      {
        onSuccess: (r) => {
          const reaproveitou = (r as { reused_user: boolean }).reused_user;
          toast.success(
            `${nome} foi adicionado(a)`,
            reaproveitou
              ? `Esta pessoa já usava o ${MARCA.produto} em outra organização e agora tem acesso aqui também.`
              : 'Para entrar, a pessoa precisa de uma senha definida pela administração da plataforma.'
          );
          limpar();
          onOpenChange(false);
        },
      }
    );
  }

  const campoComErro = (c: string) => (erro?.campo === c ? erro.mensagem : null);

  return (
    <Dialog
      open={open}
      size="lg"
      onOpenChange={(o) => {
        if (!o) limpar();
        onOpenChange(o);
      }}
      title="Adicionar usuário"
      description="Perfil de acesso, dados de cadastro e o que a pessoa enxerga — tudo numa vez só."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="primary" loading={adicionar.isPending} onClick={enviar}>
            Adicionar usuário
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Perfil de acesso</legend>
          <div role="radiogroup" aria-label="Perfil de acesso" className="grid gap-2 sm:grid-cols-3">
            {PERFIS.map((p) => (
              <label
                key={p.key}
                className={cn(
                  'flex min-h-12 cursor-pointer flex-col gap-1 rounded-control border p-3 text-sm',
                  perfil === p.key ? 'border-accent bg-accent-soft' : 'border-border-subtle'
                )}
              >
                <span className="flex items-center gap-2 font-medium text-text">
                  <input
                    type="radio"
                    name="perfil"
                    value={p.key}
                    checked={perfil === p.key}
                    onChange={() => setPerfil(p.key)}
                  />
                  {p.rotulo}
                </span>
                <span className="text-xs text-muted">{p.descricao}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            O perfil define o que a pessoa pode fazer. A profissão, abaixo, é só cadastro.
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required error={campoComErro('name')}>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
          </Field>
          <Field label="E-mail" required error={campoComErro('email')} hint="É por ele que a pessoa entra.">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@empresa.com.br"
            />
          </Field>
          <Field label="CPF" error={campoComErro('cpf')}>
            <Input
              inputMode="numeric"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
            />
          </Field>
          <Field label="Telefone" error={campoComErro('phone')}>
            <Input
              type="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(31) 90000-0000"
            />
          </Field>
          <Field label="Profissão / função" error={campoComErro('job_title')} hint="Não concede permissão.">
            <Input list="profissoes" value={profissao} onChange={(e) => setProfissao(e.target.value)} />
          </Field>
          <Field label="Empresa / organização" error={campoComErro('company_name')}>
            <Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
          </Field>
        </div>
        <datalist id="profissoes">
          {PROFISSOES.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>

        <EditorDeRegistros
          registros={registros}
          onChange={setRegistros}
          erro={campoComErro('registrations')}
        />

        <EscolhaDeEscopo
          aberto={open}
          clienteId={clienteId}
          setores={setores}
          onCliente={(id) => {
            setClienteId(id);
            setSetores([]);
          }}
          onSetores={setSetores}
        />

        {erro && !erro.campo && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro.mensagem}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Cliente/hospital e setores. "Todos" é a ausência de restrição, dita por extenso. */
function EscolhaDeEscopo({
  aberto,
  clienteId,
  setores,
  onCliente,
  onSetores,
}: {
  aberto: boolean;
  clienteId: string;
  setores: string[];
  onCliente: (id: string) => void;
  onSetores: (ids: string[]) => void;
}) {
  const { data: clientes } = useApiQuery(customersList, undefined, { enabled: aberto }) as {
    data: { items: Customer[] } | undefined;
  };
  const { data: detalhe } = useApiQuery(
    customersDetail,
    { params: { id: clienteId } },
    { enabled: aberto && Boolean(clienteId) }
  ) as { data: { locations: CustomerLocation[] } | undefined };

  const setoresDoCliente = useMemo(
    () => (detalhe?.locations ?? []).filter((l) => l.location_type_key === 'setor'),
    [detalhe]
  );

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium text-text">O que a pessoa enxerga</legend>
      <Field label="Cliente / hospital" hint="Sem escolha, enxerga todos os clientes da organização.">
        <Select value={clienteId} onChange={(e) => onCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {(clientes?.items ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.trade_name || c.name}
            </option>
          ))}
        </Select>
      </Field>
      {clienteId && (
        <div>
          <p className="mb-2 text-sm text-text">Setores</p>
          {setoresDoCliente.length === 0 ? (
            <p className="text-xs text-muted">
              Este cliente ainda não tem setores: a pessoa verá o hospital inteiro.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Setores permitidos">
              {setoresDoCliente.map((s) => {
                const marcado = setores.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm',
                      marcado ? 'border-accent bg-accent-soft' : 'border-border-subtle'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() =>
                        onSetores(marcado ? setores.filter((x) => x !== s.id) : [...setores, s.id])
                      }
                    />
                    {s.name}
                  </label>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            {setores.length === 0
              ? 'Nenhum setor marcado: a pessoa enxerga todos os setores deste hospital.'
              : `Só ${setores.length === 1 ? 'este setor' : `estes ${setores.length} setores`}.`}
          </p>
        </div>
      )}
    </fieldset>
  );
}

function EditorDeRegistros({
  registros,
  onChange,
  erro,
}: {
  registros: Registro[];
  onChange: (r: Registro[]) => void;
  erro: string | null;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-text">Registros profissionais</legend>
      {registros.length === 0 && (
        <p className="mb-2 text-xs text-muted">Nenhum. Quando houver, informe tipo e número.</p>
      )}
      <div className="flex flex-col gap-2">
        {registros.map((r, i) => (
          <div key={i} className="grid grid-cols-[7rem_1fr_4.5rem_auto] items-end gap-2">
            <Field label="Tipo">
              <Select
                value={r.kind}
                onChange={(e) =>
                  onChange(
                    registros.map((x, j) => (j === i ? { ...x, kind: e.target.value as TipoDeRegistro } : x))
                  )
                }
              >
                {TIPOS_DE_REGISTRO.map((t) => (
                  <option key={t} value={t}>
                    {t === 'OUTRO' ? 'Outro' : t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Número">
              <Input
                value={r.number}
                onChange={(e) =>
                  onChange(registros.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))
                }
              />
            </Field>
            <Field label="UF">
              <Input
                maxLength={2}
                value={r.region}
                onChange={(e) =>
                  onChange(
                    registros.map((x, j) => (j === i ? { ...x, region: e.target.value.toUpperCase() } : x))
                  )
                }
              />
            </Field>
            <Button
              variant="ghost"
              aria-label={`Remover registro ${r.kind} ${r.number}`}
              icon={<Trash2 className="size-4" />}
              onClick={() => onChange(registros.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </div>
      <Button
        className="mt-2"
        size="sm"
        icon={<Plus className="size-4" />}
        onClick={() => onChange([...registros, { kind: 'CRM', number: '', region: '' }])}
      >
        Adicionar registro
      </Button>
      {erro && (
        <p role="alert" className="mt-2 text-sm text-bad-text">
          {erro}
        </p>
      )}
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Cadastro (ver e editar)                                                    */
/* -------------------------------------------------------------------------- */

function DialogoCadastro({ membro, onFechar }: { membro: Member; onFechar: () => void }) {
  const { data, isLoading } = useApiQuery(membersDetail, { params: { id: membro.membership_id } }) as {
    data: MemberDetail | undefined;
    isLoading: boolean;
  };
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title={membro.name || membro.email}
      description="Dados de cadastro. Perfil e permissões ficam em “Ver acesso e permissões”."
    >
      {isLoading || !data ? (
        <SkeletonList rows={4} label="cadastro" />
      ) : (
        <FormularioCadastro dados={data} onFechar={onFechar} />
      )}
    </Dialog>
  );
}

function FormularioCadastro({ dados, onFechar }: { dados: MemberDetail; onFechar: () => void }) {
  const toast = useToast();
  const [cpf, setCpf] = useState(dados.cpf ?? '');
  const [telefone, setTelefone] = useState(dados.phone ?? '');
  const [profissao, setProfissao] = useState(dados.job_title ?? '');
  const [empresa, setEmpresa] = useState(dados.company_name ?? '');
  const [registros, setRegistros] = useState<Registro[]>(
    dados.registrations.map((r) => ({
      kind: r.kind as TipoDeRegistro,
      number: r.number,
      region: r.region ?? '',
    }))
  );
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);

  const salvar = useApiMutation(membersUpdate, {
    invalidates: [membersList, membersDetail],
    onError: (e: ApiError) => setErro({ campo: e.field, mensagem: e.problem.message }),
  });
  const situacao = SITUACAO[dados.status] ?? SITUACAO.active!;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {dados.email} ·{' '}
        <StatusChip tone={situacao.tom} size="sm">
          {situacao.rotulo}
        </StatusChip>
        {dados.status_reason && dados.status !== 'active' && <> · Motivo: {dados.status_reason}</>}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CPF" error={erro?.campo === 'cpf' ? erro.mensagem : null}>
          <Input inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} />
        </Field>
        <Field label="Telefone" error={erro?.campo === 'phone' ? erro.mensagem : null}>
          <Input type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </Field>
        <Field label="Profissão / função" hint="Não concede permissão.">
          <Input list="profissoes-edicao" value={profissao} onChange={(e) => setProfissao(e.target.value)} />
        </Field>
        <Field label="Empresa / organização">
          <Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
        </Field>
      </div>
      <datalist id="profissoes-edicao">
        {PROFISSOES.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <EditorDeRegistros
        registros={registros}
        onChange={setRegistros}
        erro={erro?.campo === 'registrations' ? erro.mensagem : null}
      />
      {erro && !erro.campo && (
        <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
          {erro.mensagem}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onFechar}>Fechar</Button>
        <Button
          variant="primary"
          loading={salvar.isPending}
          onClick={() =>
            salvar.mutate(
              {
                params: { id: dados.membership_id },
                body: {
                  cpf: cpf || null,
                  phone: telefone || null,
                  job_title: profissao || null,
                  company_name: empresa || null,
                  registrations: registros
                    .filter((r) => r.number.trim())
                    .map((r) => ({ kind: r.kind, number: r.number, region: r.region || null })),
                },
              },
              {
                onSuccess: () => {
                  toast.success('Cadastro atualizado');
                  onFechar();
                },
              }
            )
          }
        >
          Salvar cadastro
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Situação do acesso                                                         */
/* -------------------------------------------------------------------------- */

const TEXTO_DA_SITUACAO: Record<
  Situacao,
  { titulo: string; descricao: string; botao: string; exemplo: string }
> = {
  suspended: {
    titulo: 'Suspender',
    descricao:
      'Pausa administrativa: o acesso é recusado já na próxima requisição. Nada é apagado — o histórico continua tendo dono.',
    botao: 'Suspender acesso',
    exemplo: 'Ex.: afastamento até 30/11.',
  },
  blocked: {
    titulo: 'Bloquear',
    descricao:
      'Corte por segurança ou política: o acesso é recusado já na próxima requisição. Só quem gerencia usuários desbloqueia.',
    botao: 'Bloquear acesso',
    exemplo: 'Ex.: conta compartilhada indevidamente.',
  },
  active: {
    titulo: 'Reativar',
    descricao: 'Devolve o acesso com o mesmo perfil e o mesmo escopo de antes.',
    botao: 'Reativar acesso',
    exemplo: 'Ex.: retorno do afastamento.',
  },
};

function DialogoSituacao({
  membro,
  para,
  onFechar,
}: {
  membro: Member;
  para: Situacao;
  onFechar: () => void;
}) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const texto = TEXTO_DA_SITUACAO[para];
  const nome = membro.name || membro.email;

  const mudar = useApiMutation(membersSetStatus, {
    invalidates: [membersList, membersDetail],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={`${texto.titulo} ${nome}`}
      description={texto.descricao}
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant={para === 'active' ? 'primary' : 'danger'}
            loading={mudar.isPending}
            onClick={() =>
              mudar.mutate(
                { params: { id: membro.membership_id }, body: { status: para, reason: motivo } },
                {
                  onSuccess: () => {
                    toast.success(`${texto.botao}: ${nome}`);
                    onFechar();
                  },
                }
              )
            }
          >
            {texto.botao}
          </Button>
        </>
      }
    >
      <Field
        label="Motivo"
        required
        error={erro}
        hint="Fica registrado: “por que essa pessoa perdeu (ou recuperou) o acesso?” precisa ter resposta."
      >
        <Textarea
          value={motivo}
          onChange={(e) => {
            setMotivo(e.target.value);
            setErro(null);
          }}
          rows={3}
          placeholder={texto.exemplo}
        />
      </Field>
    </Dialog>
  );
}
