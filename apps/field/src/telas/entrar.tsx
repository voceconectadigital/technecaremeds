/**
 * Aurora — entrada do aplicativo de campo.
 *
 * ENTRAR É A ÚNICA COISA AQUI QUE EXIGE REDE, e a tela diz isso.
 *
 * Depois da primeira entrada e da primeira sincronização, o aparelho trabalha o
 * dia inteiro sem sinal. Antes delas, não há o que fazer — e prometer o
 * contrário seria pior do que avisar: o técnico desceria para o subsolo com um
 * aplicativo vazio, achando que estava pronto.
 *
 * A ORGANIZAÇÃO É ESCOLHIDA AQUI, e não depois.
 *
 * Diferente do portal — em que a pessoa pertence a um cliente só —, um técnico
 * pode atender por duas prestadoras. Perguntar depois faria a primeira
 * sincronização baixar o dia da organização errada, e o dia errado no aparelho
 * é pior do que aparelho nenhum.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Card, Field, Input } from '@aurora/ui';
import { useSession } from '@aurora/app-kit';

export function EntrarPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [organizacao, setOrganizacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <form
          noValidate
          className="flex flex-col gap-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            const limpo = email.trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) {
              setErro('Informe um endereço de e-mail válido.');
              return;
            }
            if (!organizacao.trim()) {
              setErro('Informe a organização — é ela que decide qual dia baixar.');
              return;
            }
            try {
              localStorage.setItem('aurora:organizacao', organizacao.trim());
            } catch {
              /* Modo privado. A sessão vive só nesta aba, e é dito abaixo. */
            }
            signIn(`local:${limpo}:${limpo}`);
            void navigate({ to: '/' });
          }}
        >
          <header className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-xl font-semibold text-text">Aurora Campo</h1>
            <p className="text-sm text-muted">
              Entre uma vez, com rede. Depois disso o aplicativo funciona o dia inteiro sem sinal.
            </p>
          </header>

          <Field label="Seu e-mail" required error={erro}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@prestadora.com.br"
              autoFocus
              className="min-h-12"
            />
          </Field>

          <Field
            label="Organização"
            required
            hint="Um técnico pode atender por mais de uma prestadora — é esta escolha que decide qual dia baixar."
          >
            <Input
              value={organizacao}
              onChange={(e) => setOrganizacao(e.target.value)}
              className="min-h-12"
            />
          </Field>

          <Button type="submit" variant="primary" className="min-h-12 w-full">
            Entrar
          </Button>

          <p className="text-center text-xs text-subtle">
            Ambiente de desenvolvimento: qualquer e-mail cadastrado entra sem senha. A API recusa este modo
            fora de desenvolvimento.
          </p>
        </form>
      </Card>
    </div>
  );
}
