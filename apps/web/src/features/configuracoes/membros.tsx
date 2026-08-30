/**
 * Aurora — pessoas da organização (SPEC v0.2 §05 · EPIC-002).
 *
 * O convite cria pessoa, vínculo, escopo e papéis numa transação só. O escopo
 * é parte do formulário, e não um segundo passo: quem entra sem escopo vê uma
 * tela vazia e não consegue distinguir isso de falta de permissão.
 */
import { useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
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
import { membersInvite, membersList, membersSuspend, type Member } from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery, usePermissions, MARCA } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { GavetaDeAcesso } from './acesso';
import { AlternadorDeConfiguracoes } from './alternador';

export function MembrosPage() {
  const [convidando, setConvidando] = useState(false);
  const [suspendendo, setSuspendendo] = useState<Member | null>(null);
  const [vendoAcesso, setVendoAcesso] = useState<Member | null>(null);
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
      title="Pessoas"
      subtitle="Quem tem acesso a esta organização, com que papel e sobre o quê."
      breadcrumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Pessoas' }]}
      actions={
        <Can permission="organization.manage_members">
          <Button
            variant="primary"
            icon={<UserPlus className="size-4" />}
            onClick={() => setConvidando(true)}
          >
            Convidar
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
            <SkeletonList rows={5} label="pessoas" />
          </div>
        ) : membros.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="Ninguém além de você"
            description="Convide quem trabalha com você. O convite vale na hora — não há e-mail de confirmação a esperar."
            action={
              <Button variant="primary" onClick={() => setConvidando(true)}>
                Convidar a primeira pessoa
              </Button>
            }
          />
        ) : (
          <ul>
            {membros.map((m, i) => (
              <li
                key={m.membership_id}
                className={cn('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-border-subtle')}
              >
                <Avatar name={m.name || m.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base text-text">
                    {m.name || m.email}
                    {m.is_owner && (
                      <StatusChip tone="accent" size="sm" withoutDot className="ml-2">
                        Proprietário
                      </StatusChip>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                </div>

                <div className="hidden items-center gap-1.5 sm:flex">
                  {m.roles.length === 0 ? (
                    <StatusChip
                      tone="warn"
                      size="sm"
                      hint="Sem papel, a pessoa entra e não consegue fazer nada"
                    >
                      Sem papel
                    </StatusChip>
                  ) : (
                    m.roles.map((r) => (
                      <StatusChip key={r} tone="neutral" size="sm" withoutDot>
                        {rotuloDoPapel(r)}
                      </StatusChip>
                    ))
                  )}
                </div>

                <StatusChip tone={m.status === 'active' ? 'good' : 'neutral'} size="sm">
                  {m.status === 'active' ? 'Ativo' : 'Suspenso'}
                </StatusChip>

                {can('organization.manage_members') && m.status === 'active' && (
                  <Menu
                    label={`Ações para ${m.name || m.email}`}
                    trigger={
                      <Button aria-label={`Ações para ${m.name || m.email}`} variant="ghost" size="sm">
                        ⋯
                      </Button>
                    }
                    items={[
                      {
                        // A primeira ação é VER, e não mudar: a pergunta que
                        // traz alguém a este menu é "por que essa pessoa não
                        // consegue?", e responder antes de mexer é o que evita
                        // o papel a mais concedido "para destravar".
                        label: 'Ver acesso e permissões',
                        onSelect: () => setVendoAcesso(m),
                      },
                      {
                        label: 'Suspender acesso',
                        destructive: true,
                        onSelect: () => setSuspendendo(m),
                        disabled: m.is_owner,
                        disabledReason:
                          'O proprietário não pode ser suspenso: transfira a titularidade antes.',
                      },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {vendoAcesso && <GavetaDeAcesso membro={vendoAcesso} onFechar={() => setVendoAcesso(null)} />}
      <DialogoConvite open={convidando} onOpenChange={setConvidando} />
      {suspendendo && <DialogoSuspensao membro={suspendendo} onFechar={() => setSuspendendo(null)} />}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

function DialogoConvite({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [papel, setPapel] = useState('technician');
  const [erro, setErro] = useState<{ campo?: string; mensagem: string } | null>(null);

  const convidar = useApiMutation(membersInvite, {
    invalidates: [membersList],
    onError: (e: ApiError) => setErro({ campo: e.field, mensagem: e.problem.message }),
  });

  function limpar() {
    setEmail('');
    setNome('');
    setPapel('technician');
    setErro(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) limpar();
        onOpenChange(o);
      }}
      title="Convidar pessoa"
      description="A pessoa passa a ter acesso imediatamente. Se o e-mail já existir na plataforma, ela ganha mais um vínculo — e não um segundo cadastro."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="primary"
            loading={convidar.isPending}
            onClick={() =>
              convidar.mutate(
                { body: { email, name: nome, role_keys: [papel] } },
                {
                  onSuccess: (r) => {
                    const reaproveitou = (r as { reused_user: boolean }).reused_user;
                    toast.success(
                      `${nome} foi convidada`,
                      reaproveitou
                        ? `Esta pessoa já usava o ${MARCA.produto} em outra organização e agora tem acesso aqui também.`
                        : 'O acesso já está valendo.'
                    );
                    limpar();
                    onOpenChange(false);
                  },
                }
              )
            }
          >
            Convidar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="E-mail"
          required
          error={erro?.campo === 'email' ? erro.mensagem : null}
          hint="É por ele que a pessoa entra."
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErro(null);
            }}
            placeholder="pessoa@empresa.com.br"
          />
        </Field>

        <Field label="Nome" required error={erro?.campo === 'name' ? erro.mensagem : null}>
          <Input
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
              setErro(null);
            }}
            placeholder="Como ela é chamada no dia a dia"
          />
        </Field>

        <Field
          label="Papel"
          hint="Define o que ela pode fazer. Dá para ajustar depois, e dá para ter mais de um."
        >
          <Select value={papel} onChange={(e) => setPapel(e.target.value)}>
            <option value="technician">Técnico</option>
            <option value="coordinator">Coordenador</option>
            <option value="maintenance_manager">Gestor de manutenção</option>
            <option value="stockkeeper">Almoxarife</option>
            <option value="finance">Financeiro</option>
            <option value="auditor">Auditor</option>
            <option value="admin">Administrador</option>
          </Select>
        </Field>

        {/* Erro que não pertence a um campo — conflito, por exemplo. */}
        {erro && !erro.campo && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro.mensagem}
          </p>
        )}

        <p className="text-xs text-muted">
          O acesso nasce vendo todos os clientes e locais desta organização. Para restringir, ajuste o escopo
          depois de convidar.
        </p>
      </div>
    </Dialog>
  );
}

function DialogoSuspensao({ membro, onFechar }: { membro: Member; onFechar: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const suspender = useApiMutation(membersSuspend, {
    invalidates: [membersList],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={`Suspender ${membro.name || membro.email}`}
      description="O acesso é cortado na hora. O vínculo NÃO é apagado: o histórico do que essa pessoa fez continua tendo dono."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant="danger"
            loading={suspender.isPending}
            onClick={() =>
              suspender.mutate(
                { params: { id: membro.membership_id }, body: { reason: motivo } },
                {
                  onSuccess: () => {
                    toast.success(`Acesso de ${membro.name || membro.email} suspenso`);
                    onFechar();
                  },
                }
              )
            }
          >
            Suspender acesso
          </Button>
        </>
      }
    >
      <Field
        label="Motivo"
        required
        error={erro}
        hint="Fica registrado. Seis meses depois, “por que essa pessoa perdeu o acesso?” precisa ter resposta."
      >
        <Textarea
          value={motivo}
          onChange={(e) => {
            setMotivo(e.target.value);
            setErro(null);
          }}
          rows={3}
          placeholder="Ex.: encerrou o contrato de prestação em 28/08."
        />
      </Field>
    </Dialog>
  );
}

const PAPEIS: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  maintenance_manager: 'Gestor de manutenção',
  coordinator: 'Coordenador',
  technician: 'Técnico',
  metrologist: 'Metrologista',
  stockkeeper: 'Almoxarife',
  finance: 'Financeiro',
  auditor: 'Auditor',
  requester: 'Solicitante',
  customer_manager: 'Gestor do cliente',
};

function rotuloDoPapel(chave: string): string {
  return PAPEIS[chave] ?? chave;
}
