/**
 * Aurora — escolher a organização (SPEC v0.2 §05).
 *
 * "Trocar de organização é uma ação explícita, nunca implícita por URL."
 *
 * É por isso que esta tela existe em vez de um seletor discreto no canto: a
 * consultora que atende duas empresas precisa saber, sem dúvida, em qual está
 * antes de fechar uma OS. Um seletor que troca em silêncio produz a OS certa
 * no cliente errado.
 *
 * Quem tem UMA organização não vê esta tela: é levado direto. Escolher entre
 * uma opção não é escolha, é obstáculo.
 */
import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Building2, LogOut } from 'lucide-react';
import { Button, Card, EmptyState, SkeletonList, StatusChip } from '@aurora/ui';
import { meOrganizations, type OrganizationOption } from '@aurora/contracts';
import { useApiQuery, useSession, useEncerrarSessao } from '@aurora/app-kit';
import { ErrorScreen } from '../shell/error-boundary';

export function OrganizacoesPage() {
  const navigate = useNavigate();
  const { chooseOrganization, organizationId } = useSession();
  const encerrarSessao = useEncerrarSessao();

  const { data, isLoading, isError, error } = useApiQuery(meOrganizations, undefined, {
    retry: false,
  }) as {
    data: { items: OrganizationOption[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  const itens = data?.items;
  const unica = itens?.length === 1 ? itens[0] : undefined;

  // Uma só: escolhe e segue. O `useEffect` é o lugar certo porque a navegação
  // é efeito, não renderização.
  useEffect(() => {
    if (!unica) return;
    chooseOrganization(unica.organization_id);
    void navigate({ to: '/', replace: true });
  }, [unica, chooseOrganization, navigate]);

  if (isError) return <ErrorScreen error={error} />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-md">
        <div className="border-b border-border-subtle px-6 py-5">
          <h1 className="text-lg font-semibold text-text">Escolha a organização</h1>
          <p className="mt-1 text-sm text-muted">
            Você tem vínculo com mais de uma. Tudo o que fizer a seguir acontece dentro da que escolher aqui.
          </p>
        </div>

        <div className="p-3">
          {isLoading && <SkeletonList rows={3} label="organizações" />}

          {itens?.length === 0 && (
            <EmptyState
              icon={<Building2 className="size-5" />}
              title="Você ainda não tem vínculo com nenhuma organização"
              description="Peça a quem administra para convidar o seu e-mail. Convites entram em vigor na hora."
              action={
                <Button
                  variant="secondary"
                  icon={<LogOut className="size-4" />}
                  onClick={() => {
                    void encerrarSessao().then(() => navigate({ to: '/entrar' }));
                  }}
                >
                  Entrar com outro e-mail
                </Button>
              }
            />
          )}

          <ul className="flex flex-col gap-1">
            {itens?.map((org) => (
              <li key={org.organization_id}>
                <button
                  type="button"
                  onClick={() => {
                    chooseOrganization(org.organization_id);
                    void navigate({ to: '/' });
                  }}
                  className="flex w-full items-center gap-3 rounded-control px-3 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <Building2 aria-hidden="true" className="size-4 shrink-0 text-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-text">{org.name}</span>
                    <span className="block truncate text-xs text-muted">{org.slug}</span>
                  </span>
                  {org.is_owner && (
                    <StatusChip tone="accent" size="sm" withoutDot>
                      Proprietário
                    </StatusChip>
                  )}
                  {org.organization_id === organizationId && (
                    <StatusChip tone="good" size="sm">
                      Atual
                    </StatusChip>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}
