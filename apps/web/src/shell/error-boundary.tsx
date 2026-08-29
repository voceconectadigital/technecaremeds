/**
 * Aurora — a tela de erro (SPEC v0.2 §35).
 *
 * O QUE ESTA TELA PRECISA FAZER, E QUASE NENHUMA FAZ
 *
 *   · dizer o que aconteceu na linguagem de quem lê, e não "Error: undefined
 *     is not a function";
 *   · distinguir SEM PERMISSÃO de NÃO EXISTE de QUEBROU — as três pedem ações
 *     diferentes, e tratá-las como uma só faz a pessoa pedir acesso quando o
 *     problema era o link;
 *   · mostrar o identificador da requisição, que é o que permite ao suporte
 *     achar a linha exata do log;
 *   · oferecer um caminho de volta que não seja recarregar a página inteira.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RotateCcw, ShieldOff } from 'lucide-react';
import { Button, Card, EmptyState } from '@aurora/ui';
import { ApiError } from '../lib/api';

interface Props {
  children: ReactNode;
  /** Chamado ao pedir nova tentativa — normalmente limpa o cache da consulta. */
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Ainda não há coletor de erro configurado, e inventar um endereço para
    // mandar isto seria pior do que não mandar. O console é honesto sobre o
    // que existe hoje.
    console.error('[aurora] erro não tratado na interface', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ErrorScreen
        error={error}
        onRetry={() => {
          this.setState({ error: null });
          this.props.onRetry?.();
        }}
      />
    );
  }
}

export function ErrorScreen({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof ApiError ? error : null;

  // Sem permissão é um caso à parte: não adianta "tentar de novo", e a saída é
  // pedir acesso a quem administra — não recarregar.
  if (api?.problem.code === 'forbidden') {
    return (
      <Moldura>
        <EmptyState
          icon={<ShieldOff className="size-5" />}
          title="Você não tem acesso a esta tela"
          description={
            api.missingPermission
              ? `Falta a permissão ${api.missingPermission}. Peça a quem administra a organização.`
              : 'Peça acesso a quem administra a organização.'
          }
          action={
            <Button
              variant="secondary"
              icon={<Home className="size-4" />}
              onClick={() => (location.href = '/')}
            >
              Ir para o início
            </Button>
          }
        />
        <Rodape requestId={api.problem.request_id} />
      </Moldura>
    );
  }

  if (api?.problem.code === 'not_found') {
    return (
      <Moldura>
        <EmptyState
          icon={<AlertTriangle className="size-5" />}
          title="Não encontramos este registro"
          description="Ele pode ter sido removido, ou estar fora do seu escopo de acesso."
          action={
            <Button
              variant="secondary"
              icon={<Home className="size-4" />}
              onClick={() => (location.href = '/')}
            >
              Ir para o início
            </Button>
          }
        />
        <Rodape requestId={api.problem.request_id} />
      </Moldura>
    );
  }

  return (
    <Moldura>
      <EmptyState
        icon={<AlertTriangle className="size-5" />}
        title="Alguma coisa quebrou aqui"
        description={
          api?.problem.message ??
          (error instanceof Error ? error.message : 'Falha inesperada ao carregar a tela.')
        }
        action={
          <div className="flex gap-2">
            {onRetry && (
              <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={onRetry}>
                Tentar de novo
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<Home className="size-4" />}
              onClick={() => (location.href = '/')}
            >
              Ir para o início
            </Button>
          </div>
        }
      />
      <Rodape requestId={api?.problem.request_id} />
    </Moldura>
  );
}

function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg">{children}</Card>
    </div>
  );
}

/**
 * O identificador da requisição.
 *
 * É o que transforma "deu erro" em algo que o suporte consegue investigar: com
 * ele, a linha exata do log é encontrada em segundos; sem ele, começa a
 * arqueologia por horário aproximado.
 */
function Rodape({ requestId }: { requestId?: string }) {
  if (!requestId) return null;
  return (
    <p className="border-t border-border-subtle px-6 py-3 text-center text-xs text-subtle">
      Se precisar falar com o suporte, informe este código:{' '}
      <code className="font-mono text-muted">{requestId}</code>
    </p>
  );
}
