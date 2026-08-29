/**
 * Aurora — o acesso de uma pessoa (SPEC v0.2 §04, §05 · EPIC-002).
 *
 * ESTA TELA EXISTE PARA RESPONDER UMA PERGUNTA: "por que o Rafael não
 * consegue fechar a ordem de serviço?"
 *
 * A auditoria do sistema de referência registrou o que acontece quando ela
 * não tem resposta: vira tentativa e erro, e o desfecho habitual é alguém
 * receber um papel a mais "para destravar". Repetido algumas vezes, é assim
 * que uma organização acorda com sete pessoas podendo apagar contrato.
 *
 * POR ISSO A LISTA MOSTRA PROCEDÊNCIA, E NÃO SÓ O RESULTADO.
 *
 * Cada permissão diz de onde veio — qual papel a concedeu, ou qual exceção a
 * concedeu ou negou. Uma permissão que vem de dois papéis aparece duas vezes,
 * de propósito: é exatamente essa duplicidade que explica por que remover um
 * papel não tirou o acesso, e sem ela a pessoa remove o papel errado.
 *
 * A NEGAÇÃO É A LINHA MAIS IMPORTANTE, e por isso é a mais visível: sem ela em
 * destaque, a pessoa lê "Coordenador concede work_order.complete", conclui que
 * está tudo certo, e não entende por que o botão continua ausente.
 */
import { useState } from 'react';
import { Ban, Check, KeyRound, ShieldCheck, X } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
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
  membershipPermissionClear,
  membershipPermissionSet,
  membershipPermissions,
  membershipRolesSet,
  membersList,
  permissionCatalog,
  rolesList,
  type Member,
  type PermissionInfo,
  type PermissionOrigin,
  type Role,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '../../lib/api';
import { usePermissions } from '../../lib/permissions';

export function GavetaDeAcesso({ membro, onFechar }: { membro: Member; onFechar: () => void }) {
  const { can } = usePermissions();
  const [excecao, setExcecao] = useState<string | null>(null);

  const { data, isLoading } = useApiQuery(membershipPermissions, {
    params: { id: membro.membership_id },
  }) as {
    data: { effective: string[]; items: PermissionOrigin[] } | undefined;
    isLoading: boolean;
  };

  const { data: catalogo } = useApiQuery(permissionCatalog, undefined, {
    staleTime: 30 * 60_000,
    // O catálogo é o mesmo para toda organização e não muda entre sessões;
    // pedi-lo a cada abertura da gaveta seria uma requisição por clique.
    enabled: can('organization.manage_roles'),
  }) as { data: { items: PermissionInfo[] } | undefined };

  const descricoes = new Map((catalogo?.items ?? []).map((p) => [p.key, p.description]));

  // Agrupa por permissão: a lista bruta traz uma linha por ORIGEM, e a leitura
  // natural é por permissão — "quem me dá isso?", e não "o que este papel dá?".
  const porPermissao = new Map<string, PermissionOrigin[]>();
  for (const o of data?.items ?? []) {
    const atual = porPermissao.get(o.permission_key) ?? [];
    atual.push(o);
    porPermissao.set(o.permission_key, atual);
  }
  const chaves = [...porPermissao.keys()].sort();

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={`Acesso de ${membro.name || membro.email}`}
      description="De onde vem cada permissão — e o que uma exceção mudou."
      footer={<Button onClick={onFechar}>Fechar</Button>}
    >
      <div className="flex flex-col gap-4">
        <PapeisDaPessoa membro={membro} />

        <Card>
          <CardHeader
            title="Permissões"
            description="Cada linha diz quem concede. Duas linhas iguais significam dois papéis concedendo o mesmo."
            actions={
              data && (
                <span className="text-sm text-muted tabular-nums" data-numeric>
                  {data.effective.length} efetivas
                </span>
              )
            }
          />
          <div className="max-h-96 overflow-y-auto p-2">
            {isLoading ? (
              <SkeletonList rows={6} label="permissões" />
            ) : (
              <ul className="flex flex-col gap-1">
                {chaves.map((chave) => {
                  const origens = porPermissao.get(chave)!;
                  const negada = origens.some((o) => o.effect === 'deny');
                  const efetiva = data?.effective.includes(chave) ?? false;
                  return (
                    <li
                      key={chave}
                      className={cn(
                        'rounded-control px-2.5 py-2',
                        negada ? 'bg-bad-soft' : 'hover:bg-surface-hover'
                      )}
                    >
                      <div className="flex items-baseline gap-2">
                        {efetiva ? (
                          <Check aria-hidden="true" className="size-3.5 shrink-0 text-good" />
                        ) : (
                          <Ban aria-hidden="true" className="size-3.5 shrink-0 text-bad" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-text" data-numeric>
                            {chave}
                          </span>
                          {descricoes.get(chave) && (
                            <span className="block text-xs text-muted">{descricoes.get(chave)}</span>
                          )}
                        </span>
                        {can('organization.manage_roles') && (
                          <Button size="sm" variant="ghost" onClick={() => setExcecao(chave)}>
                            Exceção
                          </Button>
                        )}
                      </div>

                      <ul className="mt-1 flex flex-wrap gap-1.5 pl-5">
                        {origens.map((o, i) => (
                          <li key={`${o.source}-${o.role_key ?? ''}-${i}`}>
                            {o.source === 'role' ? (
                              <StatusChip tone="neutral" size="sm" withoutDot>
                                <ShieldCheck aria-hidden="true" className="mr-1 inline size-3" />
                                {o.role_name ?? o.role_key}
                              </StatusChip>
                            ) : (
                              <StatusChip
                                tone={o.effect === 'deny' ? 'bad' : 'info'}
                                size="sm"
                                hint={
                                  o.reason
                                    ? `${o.reason}${o.expires_at ? ` · até ${new Date(o.expires_at).toLocaleDateString('pt-BR')}` : ' · sem prazo'}`
                                    : undefined
                                }
                              >
                                {o.effect === 'deny' ? 'Exceção nega' : 'Exceção concede'}
                              </StatusChip>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {excecao && (
        <DialogoExcecao
          membro={membro}
          permissao={excecao}
          atual={porPermissao.get(excecao)?.find((o) => o.source === 'override') ?? null}
          onFechar={() => setExcecao(null)}
        />
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Os papéis, com o conjunto inteiro sendo enviado a cada salvamento.
 *
 * Enviar o conjunto completo, e não "adicione este", é o que faz duas telas
 * abertas não somarem papéis que ninguém pediu junto: a última a salvar ganha,
 * inteira.
 */
function PapeisDaPessoa({ membro }: { membro: Member }) {
  const toast = useToast();
  const { can } = usePermissions();

  const { data } = useApiQuery(rolesList, undefined, {
    staleTime: 5 * 60_000,
    enabled: can('organization.manage_roles'),
  }) as { data: { items: Role[] } | undefined };

  const papeis = data?.items ?? [];
  const [escolhidos, setEscolhidos] = useState<Set<string> | null>(null);

  // Enquanto ninguém mexeu, o estado é o do servidor. Copiar para o estado
  // local na montagem faria a gaveta mostrar dados velhos depois de outra
  // pessoa ter mudado os papéis.
  const atuais = new Set(
    papeis.filter((p) => membro.roles.includes(p.key)).map((p) => p.id)
  );
  const selecao = escolhidos ?? atuais;
  const mudou = escolhidos !== null && !mesmosItens(escolhidos, atuais);

  const salvar = useApiMutation(membershipRolesSet, {
    invalidates: [membersList, membershipPermissions],
    onError: (e: ApiError) => toast.error('Não foi possível trocar os papéis', e.problem.message),
  });

  if (!can('organization.manage_roles')) return null;

  return (
    <Card>
      <CardHeader
        title="Papéis"
        description="O que a pessoa faz. Permissão avulsa é exceção, e exceção precisa de motivo."
      />
      <div className="flex flex-col gap-3 p-4">
        <ul className="flex flex-wrap gap-2">
          {papeis.map((p) => {
            const marcado = selecao.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={marcado}
                  onClick={() => {
                    const proximo = new Set(selecao);
                    if (marcado) proximo.delete(p.id);
                    else proximo.add(p.id);
                    setEscolhidos(proximo);
                  }}
                  className={cn(
                    'rounded-pill border px-3 py-1 text-sm transition-colors',
                    marcado
                      ? 'border-accent bg-accent-soft text-accent-text'
                      : 'border-border-strong text-muted hover:text-text'
                  )}
                  title={p.description ?? undefined}
                >
                  {p.name}
                  <span className="ml-1.5 text-xs opacity-70" data-numeric>
                    {p.permission_count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {mudou && (
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" onClick={() => setEscolhidos(null)}>
              Desfazer
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={salvar.isPending}
              onClick={() =>
                salvar.mutate(
                  {
                    params: { id: membro.membership_id },
                    body: { role_ids: [...selecao] },
                  },
                  {
                    onSuccess: () => {
                      toast.success('Papéis atualizados');
                      setEscolhidos(null);
                    },
                  }
                )
              }
            >
              Salvar papéis
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A exceção pontual.
 *
 * O motivo é obrigatório porque uma exceção sem motivo é indistinguível de um
 * engano: seis meses depois ninguém consegue decidir se pode removê-la, e a
 * decisão segura passa a ser deixar como está — que é como exceções se
 * acumulam para sempre.
 *
 * O prazo é sugerido, e não imposto: há exceções legítimas sem data. Mas o
 * campo começa preenchido com trinta dias, porque o padrão molda o hábito, e
 * o hábito saudável é a exceção que se apaga sozinha.
 */
function DialogoExcecao({
  membro,
  permissao,
  atual,
  onFechar,
}: {
  membro: Member;
  permissao: string;
  atual: PermissionOrigin | null;
  onFechar: () => void;
}) {
  const toast = useToast();
  const [efeito, setEfeito] = useState<'grant' | 'deny'>(atual?.effect ?? 'grant');
  const [motivo, setMotivo] = useState(atual?.reason ?? '');
  const [prazo, setPrazo] = useState(
    atual?.expires_at ? String(atual.expires_at).slice(0, 10) : emTrintaDias()
  );
  const [erro, setErro] = useState<string | null>(null);

  const gravar = useApiMutation(membershipPermissionSet, {
    invalidates: [membershipPermissions, membersList],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  const remover = useApiMutation(membershipPermissionClear, {
    invalidates: [membershipPermissions, membersList],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title="Exceção de permissão"
      description={permissao}
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          {atual && (
            <Button
              variant="ghost"
              loading={remover.isPending}
              icon={<X className="size-4" />}
              onClick={() =>
                remover.mutate(
                  { params: { id: membro.membership_id, key: permissao } },
                  {
                    onSuccess: () => {
                      toast.success('Exceção removida', 'O papel volta a decidir.');
                      onFechar();
                    },
                  }
                )
              }
            >
              Remover exceção
            </Button>
          )}
          <Button
            variant="primary"
            loading={gravar.isPending}
            icon={<KeyRound className="size-4" />}
            onClick={() => {
              if (motivo.trim().length < 5) {
                setErro('Escreva o motivo. Sem ele, ninguém consegue decidir depois se pode removê-la.');
                return;
              }
              gravar.mutate(
                {
                  params: { id: membro.membership_id, key: permissao },
                  body: {
                    effect: efeito,
                    reason: motivo.trim(),
                    expires_at: prazo ? new Date(`${prazo}T23:59:59`).toISOString() : null,
                  },
                },
                {
                  onSuccess: () => {
                    toast.success('Exceção registrada');
                    onFechar();
                  },
                }
              );
            }}
          >
            Salvar exceção
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="O que a exceção faz"
          hint="Negar vence o papel. Conceder soma ao que os papéis já dão."
        >
          <Select value={efeito} onChange={(e) => setEfeito(e.target.value as 'grant' | 'deny')}>
            <option value="grant">Conceder esta permissão</option>
            <option value="deny">Negar esta permissão</option>
          </Select>
        </Field>

        <Field
          label="Motivo"
          required
          error={erro}
          hint="Quem ler isto daqui a seis meses precisa conseguir decidir se ainda faz sentido."
        >
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Ex.: substituindo a coordenação durante as férias da Carla."
          />
        </Field>

        <Field
          label="Vale até"
          hint="Deixe em branco para não ter prazo — mas exceção sem prazo é papel que ninguém criou."
        >
          <Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function mesmosItens(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function emTrintaDias(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}
