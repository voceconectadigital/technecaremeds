/**
 * Aurora — a entrada do aplicativo de campo.
 *
 * O que estes testes protegem: que em produção o técnico entra com e-mail e
 * senha — nunca digitando o identificador de uma organização —, que a
 * organização vem das que a conta tem, e que o modo sem senha continua
 * existindo para desenvolvimento.
 *
 * A API é um `fetch` falso: a conversa com o servidor de verdade é provada nas
 * suítes de HTTP. O cliente do campo é trocado por um módulo mínimo, porque o
 * de verdade arrasta o armazenamento offline, que não tem nada a ver com a tela.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider } from '@aurora/app-kit';

const navegar = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navegar }));
vi.mock('../../campo', () => ({ API: 'http://api.teste/v1' }));

const { EntrarPage } = await import('../entrar');

type Resposta = { status?: number; corpo?: unknown };

function servidor(rotas: Record<string, Resposta | (() => Resposta)>) {
  const chamadas: { url: string; init?: RequestInit }[] = [];
  const falso = vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    const caminho = url.replace('http://api.teste/v1', '');
    const rota = rotas[`${init?.method ?? 'GET'} ${caminho}`];
    if (!rota) throw new TypeError('Failed to fetch');
    const { status = 200, corpo = {} } = typeof rota === 'function' ? rota() : rota;
    return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', falso);
  return chamadas;
}

function montar() {
  return render(
    <SessionProvider>
      <EntrarPage />
    </SessionProvider>
  );
}

const ORG_A = { organization_id: '11111111-1111-4111-8111-111111111111', name: 'Prestadora A' };
const ORG_B = { organization_id: '22222222-2222-4222-8222-222222222222', name: 'Prestadora B' };

beforeEach(() => {
  localStorage.clear();
  navegar.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('entrar no campo com senha', () => {
  it('não pede organização: com uma só, entra direto nela', async () => {
    const chamadas = servidor({
      'GET /auth/config': { corpo: { provider: 'password' } },
      'POST /auth/login': { corpo: { token: 'tok-opaco' } },
      'GET /me/organizations': { corpo: { items: [ORG_A] } },
    });
    montar();
    const senha = await screen.findByLabelText(/Senha/);
    expect(screen.queryByLabelText(/Organização/)).toBeNull();

    await userEvent.type(screen.getByLabelText(/Seu e-mail/), ' Tecnico@Prestadora.com.br ');
    await userEvent.type(senha, 'segredo-de-teste');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith({ to: '/' }));
    const login = chamadas.find((c) => c.url.endsWith('/auth/login'))!;
    expect(JSON.parse(String(login.init?.body))).toEqual({
      email: 'tecnico@prestadora.com.br',
      senha: 'segredo-de-teste',
    });
    const orgs = chamadas.find((c) => c.url.endsWith('/me/organizations'))!;
    expect((orgs.init?.headers as Record<string, string>).authorization).toBe('Bearer tok-opaco');
    expect(localStorage.getItem('aurora:token')).toBe('tok-opaco');
    expect(localStorage.getItem('aurora:organizacao')).toBe(ORG_A.organization_id);
  });

  it('com mais de uma organização, a pessoa escolhe antes de baixar o dia', async () => {
    servidor({
      'GET /auth/config': { corpo: { provider: 'password' } },
      'POST /auth/login': { corpo: { token: 'tok-opaco' } },
      'GET /me/organizations': { corpo: { items: [ORG_A, ORG_B] } },
    });
    montar();
    await userEvent.type(await screen.findByLabelText(/Seu e-mail/), 'tecnico@prestadora.com.br');
    await userEvent.type(screen.getByLabelText(/Senha/), 'segredo-de-teste');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Prestadora B' }));
    expect(navegar).toHaveBeenCalledWith({ to: '/' });
    expect(localStorage.getItem('aurora:organizacao')).toBe(ORG_B.organization_id);
  });

  it('senha errada não entra e diz o porquê', async () => {
    servidor({
      'GET /auth/config': { corpo: { provider: 'password' } },
      'POST /auth/login': { status: 401, corpo: { title: 'Unauthorized' } },
    });
    montar();
    await userEvent.type(await screen.findByLabelText(/Seu e-mail/), 'tecnico@prestadora.com.br');
    await userEvent.type(screen.getByLabelText(/Senha/), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha não conferem.');
    expect(navegar).not.toHaveBeenCalled();
    expect(localStorage.getItem('aurora:token')).toBeNull();
  });

  it('sem rede, o formulário com senha continua sendo o padrão e avisa', async () => {
    servidor({});
    montar();
    expect(await screen.findByText(/Não consegui falar com o servidor/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Senha/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Organização/)).toBeNull();
  });
});

describe('entrar no campo em desenvolvimento', () => {
  it('o modo local continua pedindo e-mail e organização, sem senha', async () => {
    servidor({ 'GET /auth/config': { corpo: { provider: 'local' } } });
    montar();
    const org = await screen.findByLabelText(/Organização/);
    expect(screen.queryByLabelText(/Senha/)).toBeNull();

    await userEvent.type(screen.getByLabelText(/Seu e-mail/), 'tecnico@prestadora.com.br');
    await userEvent.type(org, ORG_A.organization_id);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(navegar).toHaveBeenCalledWith({ to: '/' });
    expect(localStorage.getItem('aurora:token')).toBe(
      'local:tecnico@prestadora.com.br:tecnico@prestadora.com.br'
    );
    expect(localStorage.getItem('aurora:organizacao')).toBe(ORG_A.organization_id);
  });
});
