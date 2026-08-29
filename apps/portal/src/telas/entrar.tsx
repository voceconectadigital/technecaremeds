/**
 * Aurora — entrada do portal.
 *
 * A DIFERENÇA PARA A TELA INTERNA É O QUE VEM DEPOIS.
 *
 * Na aplicação interna, entrar leva à escolha de organização: quem atende duas
 * empresas precisa dizer em qual está. No portal não existe essa escolha — um
 * usuário de portal pertence a UM cliente, e apresentar um seletor de
 * organização seria oferecer uma pergunta cuja resposta o servidor já sabe, e
 * cuja alternativa errada ele recusaria.
 *
 * Por isso a organização é resolvida na primeira consulta, e não escolhida
 * aqui.
 *
 * O provedor local aceita `local:<sujeito>:<e-mail>` e o boot da API RECUSA
 * usá-lo fora de desenvolvimento — está no código do provedor, e não na
 * confiança de quem configura. Esta tela diz isso em voz alta: uma tela de
 * login que parece de produção e não é ensina a confiar nela.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Card, Field, Input } from '@aurora/ui';
import { useSession } from '@aurora/app-kit';

export function EntrarPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        {/*
          `noValidate`: a validação nossa é a que roda. A do navegador aparece
          numa bolha no idioma do sistema, sem relação com o campo e invisível
          para leitor de tela.
        */}
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
            signIn(`local:${limpo}:${limpo}`);
            // Direto para o início: um usuário de portal pertence a um
            // cliente, e não há organização a escolher.
            void navigate({ to: '/' });
          }}
        >
          <header className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-xl font-semibold text-text">Portal do cliente</h1>
            <p className="text-sm text-muted">Acompanhe seus chamados e abra novos, de onde estiver.</p>
          </header>

          <Field label="Seu e-mail" required error={erro}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@suaempresa.com.br"
              autoFocus
              // `min-h-12`: o campo é tocado com o polegar, em pé.
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
