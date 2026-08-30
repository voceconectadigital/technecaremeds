/**
 * Aurora — entrada (SPEC v0.2 §36).
 *
 * O provedor local aceita `local:<sujeito>:<e-mail>` e o boot da API RECUSA
 * usá-lo fora de desenvolvimento. Esta tela diz isso em voz alta, porque uma
 * tela de login que parece de produção e não é ensina a confiar nela.
 *
 * Quando entrar o provedor de verdade (Supabase Auth ou OIDC), o que muda aqui
 * é de onde o token vem — o resto da aplicação não sabe a diferença, que é
 * exatamente o que a porta de autenticação da §36 compra.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Card, Field, Input } from '@aurora/ui';
import { useSession, MARCA } from '@aurora/app-kit';

export function EntrarPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function entrar(e: React.FormEvent) {
    e.preventDefault();
    const limpo = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) {
      setErro('Informe um endereço de e-mail válido.');
      return;
    }
    signIn(`local:${limpo}:${limpo}`);
    // Sempre para a escolha de organização: quem tem uma só é levado adiante
    // por lá, e quem tem duas escolhe. Adivinhar aqui daria a tela errada para
    // metade das pessoas.
    void navigate({ to: '/organizacoes' });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        {/*
         * `noValidate`: a validação NOSSA é a que roda.
         *
         * Sem isto, o navegador recusa o envio antes de o React ver o clique e
         * mostra a bolha dele — no idioma do sistema operacional, sem relação
         * com o campo, e invisível para leitor de tela. A nossa mensagem fica
         * no campo, é anunciada, e está em português.
         */}
        <form onSubmit={entrar} noValidate className="flex flex-col gap-5 p-6">
          <header className="flex flex-col items-center gap-3 text-center">
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-card bg-accent text-on-accent"
            >
              <svg viewBox="0 0 24 24" fill="none" className="size-6">
                <path
                  d="M3 18a9 9 0 0 1 18 0"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <path
                  d="M7.5 18a4.5 4.5 0 0 1 9 0"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  opacity="0.55"
                />
              </svg>
            </span>
            <div>
              <h1 className="text-xl font-semibold text-text">{MARCA.produto}</h1>
              <p className="mt-1 text-sm text-muted">Entre para continuar.</p>
            </div>
          </header>

          <Field label="E-mail" error={erro} required hint="O mesmo endereço com que você foi convidado.">
            <Input
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErro(null);
              }}
              placeholder="voce@empresa.com.br"
            />
          </Field>

          <Button type="submit" variant="primary" size="lg" fullWidth>
            Entrar
          </Button>

          {/*
           * Dito com todas as letras: este é o provedor de desenvolvimento.
           * Uma tela que parece de produção e não é ensina a confiar nela.
           */}
          <p className="rounded-control bg-warn-soft px-3 py-2 text-xs text-warn-text">
            Ambiente de desenvolvimento: a entrada não pede senha e aceita qualquer e-mail com vínculo. A API
            recusa este provedor em produção.
          </p>
        </form>
      </Card>
    </div>
  );
}
