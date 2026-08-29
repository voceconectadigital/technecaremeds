/**
 * Aurora — meu perfil (SPEC v0.2 §21, §40).
 *
 * ESTA TELA MOSTRA O QUE EXISTE, e diz o que ainda não existe.
 *
 * A sessão já traz quem sou, onde estou, com que papéis e com que permissões —
 * é a primeira chamada de toda tela, e o mesmo contexto que o guard usa para
 * decidir. Não há segunda avaliação, e por isso não há como as duas
 * discordarem.
 *
 * O QUE NÃO DÁ PARA EDITAR AINDA, A TELA DIZ.
 *
 * Nome, fuso e idioma vêm do cadastro e não têm rota de escrita. Desenhar
 * campos editáveis que não salvam seria pior do que não desenhá-los: a pessoa
 * digita, clica, e descobre que nada mudou. Aqui os valores aparecem como
 * leitura, com uma frase dizendo por onde muda hoje.
 *
 * AS PERMISSÕES APARECEM PORQUE ELAS EXPLICAM A TELA.
 *
 * "Por que não vejo o menu de contratos?" é a pergunta que traz alguém aqui, e
 * a resposta é uma lista. Sem ela, a pessoa abre um chamado com a equipe de
 * suporte para descobrir o que a própria tela poderia ter dito.
 */
import { Building2, Clock, Globe, KeyRound, Mail, Shield } from 'lucide-react';
import { Card, CardHeader, Skeleton, StatusChip, cn } from '@aurora/ui';
import type { Session } from '@aurora/contracts';
import { AppShell } from '../../shell/app-shell';
import { useSessionQuery } from '@aurora/app-kit';

export function PerfilPage() {
  const { data, isLoading } = useSessionQuery() as {
    data: Session | undefined;
    isLoading: boolean;
  };

  if (isLoading || !data) {
    return (
      <AppShell title="Meu perfil">
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }

  return (
    <AppShell title="Meu perfil" subtitle="Quem você é neste sistema, e o que isso te permite fazer.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Seus dados"
            description="Vêm do cadastro. Para alterar, fale com quem administra a organização."
          />
          <dl className="flex flex-col gap-3 p-4 text-sm">
            <Info rotulo="Nome" valor={data.user.name} />
            <Info rotulo="E-mail" valor={data.user.email} icone={<Mail className="size-3.5" />} />
            <Info
              rotulo="Fuso horário"
              valor={data.user.timezone}
              icone={<Clock className="size-3.5" />}
              // O fuso é da PESSOA, e não do servidor: a agenda é lida no fuso
              // de quem lê, e um chamado das 17h em Manaus não é das 17h em
              // Belo Horizonte.
              nota="A agenda e os prazos são exibidos neste fuso."
            />
            <Info rotulo="Idioma" valor={data.user.locale} icone={<Globe className="size-3.5" />} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Onde você está" />
          <dl className="flex flex-col gap-3 p-4 text-sm">
            <Info
              rotulo="Organização"
              valor={data.organization.name}
              icone={<Building2 className="size-3.5" />}
            />
            <Info rotulo="Identificador" valor={data.organization.slug} />
            <Info
              rotulo="Como esta organização chama o que mantém"
              valor={data.organization.asset_label}
              nota="É a palavra que aparece nas telas em vez de um termo fixo."
            />
            <div>
              <dt className="flex items-center gap-1 text-xs text-subtle">
                <Shield aria-hidden="true" className="size-3.5" />
                Seus papéis
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {data.membership.roles.length === 0 ? (
                  <StatusChip tone="warn" size="sm" hint="Sem papel, você entra e não consegue fazer nada">
                    Nenhum papel
                  </StatusChip>
                ) : (
                  data.membership.roles.map((r) => (
                    <StatusChip key={r} tone="neutral" size="sm" withoutDot>
                      {r}
                    </StatusChip>
                  ))
                )}
              </dd>
            </div>
            <Info
              rotulo="Tipo de assento"
              valor={data.membership.seat_type === 'portal' ? 'Portal (cliente)' : 'Equipe'}
              nota={
                data.membership.seat_type === 'portal'
                  ? 'Assentos de portal não consomem licença.'
                  : undefined
              }
            />
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="O que você pode fazer"
            description="É esta lista que explica por que um menu aparece e outro não."
            actions={
              <span className="text-sm text-muted tabular-nums" data-numeric>
                {data.permissions.length}
              </span>
            }
          />
          <div className="p-4">
            {/*
              AGRUPADAS POR RECURSO, e não numa lista alfabética de duzentas
              linhas. A pergunta que traz alguém aqui é sobre uma área —
              "contratos", "estoque" —, e uma lista plana obriga a procurar
              pelo prefixo com o olho.
            */}
            <ul className="flex flex-col gap-3">
              {agrupar(data.permissions).map(([recurso, chaves]) => (
                <li key={recurso}>
                  <p className="text-xs font-semibold text-subtle" data-numeric>
                    {recurso}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {chaves.map((k) => (
                      <span
                        key={k}
                        className={cn('rounded-control bg-surface-sunken px-1.5 py-0.5 text-xs text-muted')}
                        data-numeric
                      >
                        {k}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>

            {data.permissions.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-warn-text">
                <KeyRound aria-hidden="true" className="size-4" />
                Você não tem nenhuma permissão nesta organização — por isso as telas aparecem vazias. Peça a
                quem administra para atribuir um papel.
              </p>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/** `work_order.read` → grupo "work_order", chave "read". */
function agrupar(permissoes: readonly string[]): Array<[string, string[]]> {
  const mapa = new Map<string, string[]>();
  for (const p of [...permissoes].sort()) {
    const ponto = p.indexOf('.');
    const recurso = ponto > 0 ? p.slice(0, ponto) : p;
    const acao = ponto > 0 ? p.slice(ponto + 1) : p;
    mapa.set(recurso, [...(mapa.get(recurso) ?? []), acao]);
  }
  return [...mapa.entries()];
}

function Info({
  rotulo,
  valor,
  icone,
  nota,
}: {
  rotulo: string;
  valor: string | null | undefined;
  icone?: React.ReactNode;
  nota?: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs text-subtle">
        {icone}
        {rotulo}
      </dt>
      {/* A nota vive DENTRO do `<dd>`: ela é parte da descrição, e um
          parágrafo irmão entre pares quebra a estrutura que o `<dl>`
          promete — o leitor de tela deixa de emparelhar termo e definição. */}
      <dd className="mt-0.5 text-sm text-text">
        {valor || <span className="text-subtle">—</span>}
        {nota && <span className="mt-0.5 block text-xs text-muted">{nota}</span>}
      </dd>
    </div>
  );
}
