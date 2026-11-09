/**
 * Aurora — tela de logomarcas da organização (Anderson, 06/11/2026).
 *
 *   · duas vagas; vazia, cada uma diz que está vazia;
 *   · com `organization.update`: enviar, substituir e remover; sem ela, só a prévia;
 *   · o envio manda a vaga, o tipo, o rótulo e a imagem em base64; formato errado nem sai.
 *
 * A API é um cliente falso e o esqueleto da aplicação é substituído: o que se prova aqui é a tela.
 * A regra (tipos, teto, permissão, isolamento) está em `api-logomarcas.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ApiClient, OperationDefinition } from '@aurora/contracts';
import { ToastProvider, TooltipProvider } from '@aurora/ui';
import { ApiProvider, PermissionsProvider, SessionProvider, ThemeProvider } from '@aurora/app-kit';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...p }: { children: ReactNode }) => <a {...(p as object)}>{children}</a>,
  useNavigate: () => vi.fn(),
  useRouterState: () => '/configuracoes/logomarcas',
}));
vi.mock('../shell/app-shell', () => ({
  AppShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('../features/configuracoes/alternador', () => ({ AlternadorDeConfiguracoes: () => null }));

import { LogomarcasPage } from '../features/configuracoes/logomarcas';

const LOGO_1 = {
  slot: 1,
  label: 'Hospital',
  file_name: 'hospital.png',
  content_type: 'image/png',
  size: 2048,
  updated_at: '2026-11-08T12:00:00.000Z',
  data_url: 'data:image/png;base64,AAAA',
};

function montar(items: unknown[], permissions: string[]) {
  const chamadas: { op: string; args: unknown }[] = [];
  const client: ApiClient = {
    urlFor: (op: OperationDefinition) => `/v1${op.path}`,
    call: (async (op: OperationDefinition, args: unknown) => {
      chamadas.push({ op: op.operationId, args });
      if (op.operationId === 'organizations.logos') return { items };
      if (op.operationId === 'organizations.logoRemove') return { ok: true };
      if (op.operationId === 'organizations.logoSet') return LOGO_1;
      throw new Error(`operação sem resposta no teste: ${op.operationId}`);
    }) as ApiClient['call'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <SessionProvider>
        <ApiProvider client={client}>
          <QueryClientProvider client={qc}>
            <TooltipProvider>
              <ToastProvider>
                <PermissionsProvider permissions={permissions}>
                  <LogomarcasPage />
                </PermissionsProvider>
              </ToastProvider>
            </TooltipProvider>
          </QueryClientProvider>
        </ApiProvider>
      </SessionProvider>
    </ThemeProvider>
  );
  return chamadas;
}

describe('LogomarcasPage', () => {
  it('sem logomarca: duas vagas vazias; o administrador vê "Enviar logomarca" nas duas', async () => {
    montar([], ['organization.update']);
    expect(await screen.findAllByText('Nenhuma logomarca nesta vaga')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Enviar logomarca' })).toHaveLength(2);
  });

  it('sem permissão de administração: só a prévia, nenhum botão', async () => {
    montar([LOGO_1], ['organization.read']);
    expect(await screen.findByRole('img', { name: 'Hospital' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Arquivo da logomarca 1')).toBeNull();
  });

  it('com logomarca: mostra a prévia, "Substituir" e "Remover"; remover chama a vaga certa', async () => {
    const chamadas = montar([LOGO_1], ['organization.update']);
    const previa = await screen.findByTestId('previa-logo-1');
    expect(within(previa).getByRole('img', { name: 'Hospital' }).getAttribute('src')).toBe(
      'data:image/png;base64,AAAA'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() =>
      expect(chamadas.find((c) => c.op === 'organizations.logoRemove')?.args).toEqual({
        params: { slot: '1' },
      })
    );
    expect(screen.getByRole('button', { name: 'Enviar logomarca' })).toBeTruthy();
  });

  it('enviar manda a vaga, o tipo, o rótulo e o base64; formato não aceito nem sai', async () => {
    const chamadas = montar([], ['organization.update']);
    await screen.findAllByText('Nenhuma logomarca nesta vaga');
    const [rotulo2] = screen.getAllByRole('textbox').slice(1);
    await userEvent.type(rotulo2!, 'Mantenedora');

    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], 'x.gif', { type: 'image/gif' });
    await userEvent.upload(screen.getByLabelText('Arquivo da logomarca 2'), gif, { applyAccept: false });
    expect(chamadas.some((c) => c.op === 'organizations.logoSet')).toBe(false);

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'grupo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Arquivo da logomarca 2'), png);
    await waitFor(() => expect(chamadas.some((c) => c.op === 'organizations.logoSet')).toBe(true));
    const envio = chamadas.find((c) => c.op === 'organizations.logoSet')!.args as {
      params: { slot: string };
      body: Record<string, unknown>;
    };
    expect(envio.params).toEqual({ slot: '2' });
    expect(envio.body).toEqual({
      file_name: 'grupo.png',
      content_type: 'image/png',
      data_base64: 'iVBORw==',
      label: 'Mantenedora',
    });
  });
});
