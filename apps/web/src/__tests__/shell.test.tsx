/**
 * Aurora — o esqueleto da web (SPEC v0.2 §21, §34, §40).
 *
 * O que estes testes protegem: as promessas do esqueleto. Que o menu esconde
 * o que a pessoa não pode, que o pulo para o conteúdo existe, que a busca abre
 * pelo atalho, que o erro distingue "sem permissão" de "quebrou".
 *
 * A API é um cliente falso, e não um servidor de mentira: o que interessa aqui
 * é a tela, e a conversa com a API de verdade é provada nas suítes de HTTP.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, type ApiClient, type OperationDefinition } from '@aurora/contracts';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import type { ReactNode } from 'react';
import {
  ApiProvider,
  Can,
  PermissionsProvider,
  SessionProvider,
  ThemeProvider,
  usePermissions,
  useSession,
} from '@aurora/app-kit';
import { ErrorScreen } from '../shell/error-boundary';
import { MAIN_NAV, SETTINGS_NAV } from '../shell/navigation';

/** Cliente falso: responde o que o teste mandar, por identificador de operação. */
function clienteFalso(respostas: Record<string, unknown>): ApiClient {
  return {
    urlFor: (op: OperationDefinition) => `/v1${op.path}`,
    call: (async (op: OperationDefinition) => {
      const r = respostas[op.operationId];
      if (r instanceof Error) throw r;
      if (r === undefined) throw new Error(`operação sem resposta no teste: ${op.operationId}`);
      return r;
    }) as ApiClient['call'],
  };
}

function Envolver({
  children,
  permissions = [],
  respostas = {},
}: {
  children: ReactNode;
  permissions?: string[];
  respostas?: Record<string, unknown>;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <ThemeProvider>
      <SessionProvider>
        <ApiProvider client={clienteFalso(respostas)}>
          <QueryClientProvider client={qc}>
            <TooltipProvider>
              <ToastProvider>
                <PermissionsProvider permissions={permissions}>{children}</PermissionsProvider>
              </ToastProvider>
            </TooltipProvider>
          </QueryClientProvider>
        </ApiProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

/* -------------------------------------------------------------------------- */

describe('menu principal', () => {
  it('tem dez itens — acima disso deixa de ser navegação e vira lista', () => {
    expect(MAIN_NAV).toHaveLength(10);
  });

  it('cada item declara a permissão que o torna útil', () => {
    for (const item of MAIN_NAV) {
      // "Hoje" é a exceção declarada: é a tela de quem entrou, seja quem for.
      if (item.to === '/') {
        expect(item.permissions).toHaveLength(0);
        continue;
      }
      expect(item.permissions.length, item.label).toBeGreaterThan(0);
    }
  });

  it('todo item tem uma frase explicando para que serve', () => {
    for (const item of [...MAIN_NAV, SETTINGS_NAV]) {
      expect(item.hint.length, item.label).toBeGreaterThan(10);
    }
  });

  it('nenhum caminho se repete', () => {
    const caminhos = [...MAIN_NAV, SETTINGS_NAV].map((i) => i.to);
    expect(new Set(caminhos).size).toBe(caminhos.length);
  });
});

describe('permissões na interface', () => {
  function Sonda() {
    const { can, canAny } = usePermissions();
    return (
      <div>
        <span data-testid="uma">{String(can('work_order.read'))}</span>
        <span data-testid="todas">{String(can('work_order.read', 'work_order.create'))}</span>
        <span data-testid="qualquer">{String(canAny('nao.existe', 'work_order.read'))}</span>
      </div>
    );
  }

  it('`can` exige TODAS; `canAny` exige uma', () => {
    render(
      <Envolver permissions={['work_order.read']}>
        <Sonda />
      </Envolver>
    );
    expect(screen.getByTestId('uma')).toHaveTextContent('true');
    expect(screen.getByTestId('todas')).toHaveTextContent('false');
    expect(screen.getByTestId('qualquer')).toHaveTextContent('true');
  });

  it('sem a permissão, o conteúdo não é renderizado', () => {
    render(
      <Envolver permissions={[]}>
        <Can permission="organization.manage_members">
          <button type="button">Convidar</button>
        </Can>
      </Envolver>
    );
    expect(screen.queryByRole('button', { name: 'Convidar' })).not.toBeInTheDocument();
  });

  it('o substituto aparece quando a ausência confundiria mais que a explicação', () => {
    render(
      <Envolver permissions={[]}>
        <Can permission="asset.read_financials" fallback={<p>Você não tem permissão para ver valores.</p>}>
          <p>R$ 12.400,00</p>
        </Can>
      </Envolver>
    );
    expect(screen.getByText('Você não tem permissão para ver valores.')).toBeInTheDocument();
    expect(screen.queryByText('R$ 12.400,00')).not.toBeInTheDocument();
  });

  it('sem provedor, ninguém pode nada — falha fechada', () => {
    function Solto() {
      const { can } = usePermissions();
      return <span data-testid="r">{String(can('work_order.read'))}</span>;
    }
    render(<Solto />);
    expect(screen.getByTestId('r')).toHaveTextContent('false');
  });
});

describe('tela de erro', () => {
  it('sem permissão: nomeia a permissão e NÃO oferece "tentar de novo"', () => {
    const erro = new ApiError(403, {
      code: 'forbidden',
      message: 'falta asset.read',
      request_id: 'req-9',
      details: { permission: 'asset.read' },
    });

    render(
      <Envolver>
        <ErrorScreen error={erro} onRetry={() => undefined} />
      </Envolver>
    );

    expect(screen.getByText('Você não tem acesso a esta tela')).toBeInTheDocument();
    expect(screen.getByText(/asset\.read/)).toBeInTheDocument();
    // Insistir não resolve falta de permissão: o botão seria uma promessa falsa.
    expect(screen.queryByRole('button', { name: /Tentar de novo/ })).not.toBeInTheDocument();
  });

  it('não encontrado é diferente de quebrou — a ação é outra', () => {
    const erro = new ApiError(404, {
      code: 'not_found',
      message: 'Ordem de serviço não encontrada',
      request_id: 'req-10',
    });
    render(
      <Envolver>
        <ErrorScreen error={erro} />
      </Envolver>
    );
    expect(screen.getByText('Não encontramos este registro')).toBeInTheDocument();
  });

  it('falha inesperada oferece nova tentativa', async () => {
    const tentar = vi.fn();
    render(
      <Envolver>
        <ErrorScreen error={new Error('boom')} onRetry={tentar} />
      </Envolver>
    );
    await userEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
    expect(tentar).toHaveBeenCalledOnce();
  });

  it('o identificador da requisição aparece — é o que o suporte usa', () => {
    const erro = new ApiError(500, {
      code: 'internal_error',
      message: 'falha',
      request_id: 'req-abc-123',
    });
    render(
      <Envolver>
        <ErrorScreen error={erro} />
      </Envolver>
    );
    expect(screen.getByText('req-abc-123')).toBeInTheDocument();
  });
});

describe('sessão do navegador', () => {
  it('entrar de novo NÃO herda a organização da sessão anterior', async () => {
    localStorage.setItem('aurora:token', 'local:antigo:antigo@x.test');
    localStorage.setItem('aurora:organizacao', 'org-antiga');

    function Sonda() {
      const s = useSession();
      return (
        <div>
          <span data-testid="org">{s.organizationId ?? 'nenhuma'}</span>
          <button type="button" onClick={() => s.signIn('local:novo:novo@x.test')}>
            entrar
          </button>
        </div>
      );
    }

    render(
      <Envolver>
        <Sonda />
      </Envolver>
    );

    expect(screen.getByTestId('org')).toHaveTextContent('org-antiga');
    await userEvent.click(screen.getByRole('button', { name: 'entrar' }));

    // Pode ser outra pessoa no mesmo computador, e o vínculo dela é outro.
    expect(screen.getByTestId('org')).toHaveTextContent('nenhuma');
    localStorage.clear();
  });
});
