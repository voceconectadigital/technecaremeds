/**
 * Aurora — entrada (SPEC v0.2 §36).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A TELA PERGUNTA AO SERVIDOR COMO SE ENTRA, EM VEZ DE SUPOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `GET /v1/auth/config` diz qual provedor de identidade aquele processo usa. A
 * tela desenha o formulário conforme a resposta:
 *
 *   password → e-mail e senha, que é o login de verdade;
 *   local    → só e-mail, sem senha, com o aviso de que é desenvolvimento.
 *
 * Por que não fixar o formulário de senha e pronto: contra um servidor com
 * provedor local, um campo de senha pareceria conferir algo que ninguém confere
 * — uma tela que parece de produção e não é ensina a confiar nela. E o contrário
 * também: esconder a senha quando o servidor a exige deixaria a pessoa sem como
 * entrar.
 *
 * O provedor NÃO é segredo e não é autorização: é a diferença entre uma tela que
 * funciona e uma que mente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O ERRO DE CREDENCIAL NÃO DIZ QUAL DOS DOIS ESTAVA ERRADO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A mensagem vem do servidor e é a mesma para e-mail inexistente e senha errada.
 * A tela a repete como veio: "não encontramos este e-mail" transformaria o
 * formulário num oráculo de cadastro, e a gentileza aparente custaria a lista de
 * quem tem conta aqui.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Card, Field, Input } from '@aurora/ui';
import { useSession, useApiQuery, useApiMutation, MARCA, ApiError } from '@aurora/app-kit';
import { authConfig, authLogin, type AuthConfig, type LoginResult } from '@aurora/contracts';

export function EntrarPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [erroSenha, setErroSenha] = useState<string | null>(null);

  /*
   * `retry: false` e `staleTime` alto: a configuração de um servidor não muda
   * durante uma sessão de login, e uma tentativa repetida contra uma API fora do
   * ar só atrasa a mensagem de que ela está fora do ar.
   */
  const { data: config, isPending: carregandoConfig } = useApiQuery(authConfig, undefined, {
    staleTime: 5 * 60_000,
    retry: false,
  }) as { data: AuthConfig | undefined; isPending: boolean };

  const login = useApiMutation(authLogin, {
    onSuccess: (dados) => {
      signIn((dados as LoginResult).token);
      /*
       * Sempre para a escolha de organização: quem tem uma só é levado adiante
       * por lá, e quem tem duas escolhe. Adivinhar aqui daria a tela errada para
       * metade das pessoas.
       */
      void navigate({ to: '/organizacoes' });
    },
    onError: (e: ApiError) => {
      /*
       * A mensagem do servidor é a que aparece. Ela já foi escrita para ser lida
       * por gente — inclusive a do bloqueio por tentativas, que é a única que
       * fala diferente, porque a pessoa certa precisa saber por que a senha
       * certa não entra.
       */
      setErro(e.message || 'Não foi possível entrar. Tente de novo.');
    },
  });

  const provedor = config?.provider ?? 'password';
  const pedeSenha = provedor !== 'local';

  function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setErroSenha(null);

    const limpo = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) {
      setErro('Informe um endereço de e-mail válido.');
      return;
    }

    if (!pedeSenha) {
      // Provedor de desenvolvimento: o token É o e-mail, e não há o que conferir.
      signIn(`local:${limpo}:${limpo}`);
      void navigate({ to: '/organizacoes' });
      return;
    }

    if (senha.length === 0) {
      setErroSenha('Informe a sua senha.');
      return;
    }

    login.mutate({ body: { email: limpo, senha } });
  }

  const entrando = login.isPending;

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

          {/*
           * O ERRO FICA ACIMA DOS CAMPOS E É ANUNCIADO.
           *
           * `role="alert"` faz o leitor de tela ler a recusa no instante em que
           * ela chega. Sem isso, quem não vê a tela aperta "Entrar" e não recebe
           * notícia nenhuma — o formulário simplesmente continua ali.
           */}
          {erro && (
            <p
              role="alert"
              className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
              data-testid="erro-de-entrada"
            >
              {erro}
            </p>
          )}

          <Field label="E-mail" required hint="O mesmo endereço com que você foi convidado.">
            <Input
              type="email"
              name="email"
              autoComplete="username"
              autoFocus
              value={email}
              disabled={entrando}
              onChange={(e) => {
                setEmail(e.target.value);
                setErro(null);
              }}
              placeholder="voce@empresa.com.br"
            />
          </Field>

          {pedeSenha && (
            <Field label="Senha" error={erroSenha} required>
              <Input
                type="password"
                name="senha"
                /*
                 * `current-password`: é o que faz o gerenciador de senhas do
                 * navegador oferecer a senha guardada em vez de propor uma nova.
                 * Com `new-password`, todo login viraria uma oferta de troca.
                 */
                autoComplete="current-password"
                value={senha}
                disabled={entrando}
                onChange={(e) => {
                  setSenha(e.target.value);
                  setErro(null);
                  setErroSenha(null);
                }}
              />
            </Field>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            disabled={entrando || carregandoConfig}
          >
            {entrando ? 'Entrando…' : 'Entrar'}
          </Button>

          {/*
           * O aviso aparece SOMENTE quando o servidor está de fato no provedor
           * de desenvolvimento. Deixá-lo fixo faria a homologação exibir um
           * aviso falso, e aviso falso treina a pessoa a ignorar os verdadeiros.
           */}
          {provedor === 'local' && (
            <p className="rounded-control bg-warn-soft px-3 py-2 text-xs text-warn-text">
              Ambiente de desenvolvimento: a entrada não pede senha e aceita qualquer e-mail com vínculo. A
              API recusa este provedor em homologação e em produção.
            </p>
          )}

          {pedeSenha && (
            <p className="text-center text-xs text-subtle">
              Esqueceu a senha? Ela é redefinida por um administrador — a recuperação por e-mail ainda não
              está disponível.
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}
