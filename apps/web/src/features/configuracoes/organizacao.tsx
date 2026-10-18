/**
 * Aurora — regras da ORGANIZAÇÃO (pente-fino PF-41).
 *
 * Configurações tinha Usuários, Metas e Automações, e nenhum lugar para o que
 * vale para a organização inteira. A exigência do parecer do equipamento na
 * conclusão da OS (`require_operational_result`) existia na API
 * (`PATCH /organizations/current/configuration`) e só era alcançável por quem
 * chamasse a rota à mão. Esta aba é a porta dela, ao lado das outras do mesmo
 * alternador — não um painel de "tudo o que se configura".
 *
 * Quem tem `organization.update` muda; os demais veem o estado, com o motivo
 * de não poderem mudar. Esconder o interruptor é conveniência — quem nega é o
 * servidor.
 */
import { ClipboardCheck } from 'lucide-react';
import { Card, CardHeader, SkeletonList, StatusChip, useToast } from '@aurora/ui';
import { organizationsCurrent, organizationsUpdateConfiguration, type Organization } from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { AlternadorDeConfiguracoes } from './alternador';

export function OrganizacaoPage() {
  const { data, isLoading, isError, error } = useApiQuery(organizationsCurrent) as {
    data: Organization | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  return (
    <AppShell
      title="Organização"
      subtitle="Regras que valem para todas as ordens de serviço desta organização."
      breadcrumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Organização' }]}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AlternadorDeConfiguracoes />
      </div>
      {isError ? (
        <ErrorScreen error={error} />
      ) : isLoading || !data ? (
        <SkeletonList rows={2} label="configurações da organização" />
      ) : (
        <ExecucaoDaOs org={data} />
      )}
    </AppShell>
  );
}

function ExecucaoDaOs({ org }: { org: Organization }) {
  const toast = useToast();
  const { can } = usePermissions();
  const pode = can('organization.update');
  const ligado = org.require_operational_result;

  const salvar = useApiMutation(organizationsUpdateConfiguration, {
    invalidates: [organizationsCurrent],
    onError: (e: ApiError) => toast.error('Configuração não alterada', e.problem.message),
  });

  function alternar(proximo: boolean) {
    salvar.mutate(
      { body: { require_operational_result: proximo } },
      {
        onSuccess: () =>
          toast.success(
            proximo ? 'Parecer obrigatório ligado' : 'Parecer obrigatório desligado',
            proximo
              ? 'Concluir a OS passa a exigir LIBERADO ou PARADO.'
              : 'Concluir a OS volta a não exigir o parecer.'
          ),
      }
    );
  }

  return (
    <Card>
      <CardHeader
        title="Execução da OS"
        description="O que a conclusão de uma ordem de serviço exige, pela web, pelo quadro e pelo app de campo."
      />
      <div className="flex flex-col gap-3 px-4 py-4">
        <label
          className={`flex min-h-11 items-start gap-3 text-sm ${pode ? 'cursor-pointer' : 'cursor-not-allowed'}`}
        >
          <input
            type="checkbox"
            role="switch"
            aria-checked={ligado}
            className="mt-0.5 size-4 shrink-0"
            checked={ligado}
            disabled={!pode || salvar.isPending}
            onChange={(e) => alternar(e.target.checked)}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 font-medium text-text">
              <ClipboardCheck aria-hidden="true" className="size-4 text-muted" />
              Exigir o parecer do equipamento (LIBERADO ou PARADO) para concluir a OS
              <StatusChip size="sm" tone={ligado ? 'good' : 'neutral'}>
                {ligado ? 'Ligado' : 'Desligado'}
              </StatusChip>
            </span>
            <span className="mt-1 block text-muted">
              Desligado por padrão. Ligado, a conclusão sem parecer é recusada e a pessoa é levada a
              informá-lo no relatório de serviço. No app de campo, o parecer passa a ser pedido junto da
              conclusão depois da próxima sincronização do aparelho.
            </span>
          </span>
        </label>
        {!pode && (
          <p role="note" className="rounded-control bg-surface-sunken px-3 py-2 text-xs text-muted">
            Só quem tem a permissão organization.update (Proprietário, Administrador) muda esta regra.
          </p>
        )}
      </div>
    </Card>
  );
}
