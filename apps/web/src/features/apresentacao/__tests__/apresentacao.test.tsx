/**
 * Téchne Care — a apresentação comercial (`/apresentacao`).
 *
 * O que estes testes protegem:
 *   - as seções e o texto que a pessoa vai apresentar estão lá;
 *   - tudo o que ainda não existe aparece com selo (EM DESENVOLVIMENTO,
 *     FUTURO, ROADMAP) — a página não pode prometer o que o produto não faz;
 *   - o nome técnico interno nunca aparece;
 *   - NENHUMA chamada de rede acontece, nem da página nem da composição da
 *     aplicação montada em volta dela (a pergunta pela sessão daria 401 e
 *     mandaria a pessoa para `/entrar` no meio da reunião).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MARCA } from '@aurora/app-kit';
import { ApresentacaoPage } from '../pagina';
import { ECOSSISTEMA } from '../conteudo';
import { ehRotaPublica } from '../rota';

let buscar: ReturnType<typeof vi.fn>;

beforeEach(() => {
  buscar = vi.fn(() => Promise.reject(new Error('a apresentação não pode chamar a rede')));
  vi.stubGlobal('fetch', buscar);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apresentação', () => {
  it('mostra o herói, as seções e os botões de entrada', () => {
    render(<ApresentacaoPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Toda a sua operação. Uma única plataforma.' })
    ).toBeInTheDocument();
    expect(screen.getByText('GESTÃO INTELIGENTE PARA O SETOR DE SAÚDE')).toBeInTheDocument();
    expect(
      screen.getByText(/Conecte engenharia clínica, assistência técnica, hospitais e prestadores de serviços/)
    ).toBeInTheDocument();

    for (const titulo of [
      /do chamado ao indicador/i,
      /catorze módulos/i,
      /painel de controle e relatórios/i,
      /operação em campo/i,
      /muitas empresas/i,
      /ecossistema em evolução/i,
      /inteligência artificial sobre o histórico/i,
      /segurança e governança/i,
      new RegExp(`conheça a ${MARCA.produto}`, 'i'),
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: titulo })).toBeInTheDocument();
    }

    // Cada seção é um marco nomeado pelo próprio título.
    expect(screen.getByRole('region', { name: /ecossistema em evolução/i })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Conhecer a plataforma' })).toHaveAttribute('href', '#visao');
    expect(screen.getByRole('link', { name: 'Entrar no sistema' })).toHaveAttribute('href', '/entrar');
    expect(screen.getByRole('link', { name: 'Entrar na plataforma' })).toHaveAttribute('href', '/entrar');
  });

  it('lista os catorze módulos atuais', () => {
    render(<ApresentacaoPage />);
    const modulos = screen.getByRole('region', { name: /catorze módulos/i });
    for (const nome of [
      'Clientes',
      'Equipamentos',
      'Solicitações',
      'Ordens de Serviço',
      'Planos de Manutenção',
      'Checklists e Procedimentos',
      'Agenda',
      'Estoque',
      'Store',
      'Contratos',
      'Orçamentos',
      'Indicadores',
      'Relatórios',
      'Automações',
    ]) {
      expect(within(modulos).getByRole('heading', { level: 4, name: nome })).toBeInTheDocument();
    }
  });

  it('marca como futuro tudo o que ainda não existe', () => {
    render(<ApresentacaoPage />);
    const eco = screen.getByRole('region', { name: /ecossistema em evolução/i });

    // Todo cartão do ecossistema tem selo — nenhum aparece como disponível.
    const cartoes = within(eco).getAllByRole('listitem');
    expect(cartoes).toHaveLength(ECOSSISTEMA.length);
    for (const c of cartoes) {
      expect(within(c).getByText(/^(EM DESENVOLVIMENTO|FUTURO)$/)).toBeInTheDocument();
    }
    expect(within(eco).getAllByText('EM DESENVOLVIMENTO')).toHaveLength(2);
    expect(within(eco).getAllByText('FUTURO')).toHaveLength(5);

    const ia = screen.getByRole('region', { name: /inteligência artificial/i });
    expect(within(ia).getByText('ROADMAP')).toBeInTheDocument();
    expect(within(ia).getByText(/ainda não faz parte do produto/i)).toBeInTheDocument();

    // Os números do painel são declarados fictícios.
    expect(screen.getByText('Dados ilustrativos')).toBeInTheDocument();
  });

  it('não promete o que o produto não faz', () => {
    render(<ApresentacaoPage />);
    const texto = document.body.textContent ?? '';
    expect(texto).not.toMatch(/aurora/i);
    expect(texto).not.toMatch(/clone/i);
    // Store sem checkout, e-mail só em fila, indicadores provisórios sem nome.
    expect(texto).not.toMatch(/checkout|pagamento|e-mail enviado|envia(mos)? e-mail/i);
    expect(texto).not.toMatch(/\bMTTR\b|\bMTBF\b/);
  });

  it('põe o título da aba enquanto está aberta e devolve o anterior ao sair', () => {
    document.title = 'antes';
    const { unmount } = render(<ApresentacaoPage />);
    expect(document.title).toBe(`${MARCA.produto} — Apresentação`);
    expect(document.title).not.toMatch(/aurora/i);
    unmount();
    expect(document.title).toBe('antes');
  });

  it('não chama a rede', () => {
    render(<ApresentacaoPage />);
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe('a rota pública dentro da aplicação inteira', () => {
  it('reconhece só a apresentação como pública', () => {
    expect(ehRotaPublica('/apresentacao')).toBe(true);
    expect(ehRotaPublica('/apresentacao/')).toBe(true);
    expect(ehRotaPublica('/')).toBe(false);
    expect(ehRotaPublica('/entrar')).toBe(false);
    expect(ehRotaPublica('/apresentacao-x')).toBe(false);
  });

  it('abre por link direto, sem sessão, sem nenhuma chamada à API e sem ir para a entrada', async () => {
    localStorage.clear();
    window.history.replaceState(null, '', '/apresentacao');
    // Importado DEPOIS de apontar o endereço: o roteador lê o histórico ao nascer.
    const { App } = await import('../../../app');

    render(<App />);

    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Toda a sua operação. Uma única plataforma.' },
        { timeout: 15_000 }
      )
    ).toBeInTheDocument();
    // Dá tempo a qualquer consulta que fosse disparada na montagem.
    await new Promise((r) => setTimeout(r, 50));
    expect(buscar).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/apresentacao');
  });
});
