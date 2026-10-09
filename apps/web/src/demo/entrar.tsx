/**
 * Téchne Care — a entrada da DEMONSTRAÇÃO.
 *
 * No lugar do formulário de e-mail e senha, um botão. A demonstração não tem
 * conta, e uma tela de senha que aceita qualquer coisa ensinaria a pessoa a
 * confiar numa tela de senha que não confere nada — que é o contrário do que a
 * entrada de verdade existe para fazer.
 *
 * O fundo, o cartão e a logo são os da entrada real (routes/entrar.tsx): quem
 * vê a demonstração vê o produto, e não uma página de marketing.
 */
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@aurora/ui';
import { MARCA, useSession } from '@aurora/app-kit';
import { useEffect } from 'react';
import { MARCADOR, ORGANIZACAO_DEMO } from './sessao';
import { MolduraDeEntrada } from '../routes/entrar-vitrine';

export function EntrarDemoPage() {
  const { signIn, chooseOrganization } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `${MARCA.produto} — Demonstração`;
  }, []);

  function explorar() {
    signIn(MARCADOR);
    chooseOrganization(ORGANIZACAO_DEMO);
    void navigate({ to: '/' });
  }

  return (
    <MolduraDeEntrada>
      <div className="flex flex-col gap-6">
        <header>
          <span
            className="inline-flex rounded-[6px] bg-accent-soft px-2 py-0.5 text-2xs font-semibold tracking-label text-accent-text"
            data-testid="selo-demonstracao"
          >
            DEMONSTRAÇÃO
          </span>
          <h1 className="mt-3 text-2xl font-bold tracking-display text-text">Ambiente de demonstração</h1>
          <p className="mt-1.5 text-base text-muted">{MARCA.descricao}</p>
        </header>

        <p className="text-sm text-muted">
          Navegue pela plataforma com uma operação fictícia de engenharia clínica: chamados, ordens de
          serviço, agenda, ativos, estoque, contratos e indicadores.
        </p>

        <Button variant="primary" size="lg" fullWidth onClick={explorar} autoFocus>
          Explorar plataforma
        </Button>

        <p className="border-t border-border-subtle pt-4 text-xs text-subtle">
          Dados fictícios e não persistentes. Nenhuma informação digitada aqui é enviada ou gravada.
        </p>
      </div>
    </MolduraDeEntrada>
  );
}
