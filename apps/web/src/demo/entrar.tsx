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
import { Button, Card, Logo } from '@aurora/ui';
import { MARCA, useSession } from '@aurora/app-kit';
import { useEffect } from 'react';
import { MARCADOR, ORGANIZACAO_DEMO } from './sessao';

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
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-bg p-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(60rem 30rem at 15% -10%, color-mix(in oklab, var(--color-accent) 16%, transparent), transparent 60%),' +
            'radial-gradient(45rem 26rem at 95% 110%, color-mix(in oklab, var(--color-brand-accent) 13%, transparent), transparent 62%)',
        }}
      />

      <Card raised className="relative w-full max-w-md">
        <div className="flex flex-col gap-6 p-7 sm:p-8">
          <header className="flex flex-col items-center gap-4 text-center">
            <Logo
              src={MARCA.logoHorizontal}
              srcEscuro={MARCA.logoHorizontalEscuro}
              nome={MARCA.produto}
              largura={208}
            />
            <span
              className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold tracking-wider text-muted"
              data-testid="selo-demonstracao"
            >
              DEMONSTRAÇÃO
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-display text-text">Ambiente de demonstração</h1>
              <p className="mt-1 text-sm text-muted">{MARCA.descricao}</p>
            </div>
          </header>

          <p className="text-center text-sm text-muted">
            Navegue pela plataforma com uma operação fictícia de engenharia clínica: chamados, ordens de
            serviço, agenda, ativos, estoque, contratos e indicadores.
          </p>

          <Button variant="primary" size="lg" fullWidth onClick={explorar} autoFocus>
            Explorar plataforma
          </Button>

          <p className="rounded-control bg-surface-sunken px-3 py-2 text-center text-xs text-muted">
            Dados fictícios e não persistentes. Nenhuma informação digitada aqui é enviada ou gravada.
          </p>
        </div>
      </Card>
    </div>
  );
}
