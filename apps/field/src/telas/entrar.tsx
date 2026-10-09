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
 * DOIS MODOS, DECIDIDOS PELO SERVIDOR (`GET /auth/config`):
 *
 *   password  e-mail e senha em `POST /auth/login` — a mesma conta da web. A
 *             sessão é o token opaco que o servidor devolve; a organização é
 *             escolhida entre as da pessoa (`GET /me/organizations`), nunca
 *             digitada: um UUID não é coisa que se peça a um técnico.
 *   local     só em desenvolvimento: e-mail e organização, sem senha. A API
 *             recusa este modo em homologação e produção.
 *
 * A ORGANIZAÇÃO É ESCOLHIDA AQUI, e não depois. Um técnico pode atender por duas
 * prestadoras; perguntar depois faria a primeira sincronização baixar o dia da
 * organização errada, e o dia errado no aparelho é pior do que aparelho nenhum.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Card, Field, Input, Logo } from '@aurora/ui';
import { useSession, MARCA } from '@aurora/app-kit';
import { API } from '../campo';

type Provedor = 'password' | 'local' | 'desconhecido';
interface Organizacao {
  organization_id: string;
  name: string;
}

export function EntrarPage() {
  const { signIn, chooseOrganization } = useSession();
  const navigate = useNavigate();
  const [provedor, setProvedor] = useState<Provedor | null>(null);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [organizacao, setOrganizacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  /** Depois da senha: mais de uma organização → a pessoa escolhe. */
  const [opcoes, setOpcoes] = useState<Organizacao[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`${API}/auth/config`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: { provider?: string }) => {
        if (vivo) setProvedor(c.provider === 'local' ? 'local' : 'password');
      })
      .catch(() => {
        // Sem rede ou servidor fora: o formulário com senha é o padrão seguro.
        if (vivo) setProvedor('desconhecido');
      });
    return () => {
      vivo = false;
    };
  }, []);

  function entrarNa(org: Organizacao) {
    chooseOrganization(org.organization_id);
    void navigate({ to: '/' });
  }

  async function entrarComSenha(limpo: string) {
    setEnviando(true);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: limpo, senha }),
      });
      if (r.status === 401) {
        setErro('E-mail ou senha não conferem.');
        return;
      }
      if (r.status === 429) {
        setErro('Muitas tentativas desta rede. Aguarde um minuto e tente de novo.');
        return;
      }
      if (!r.ok) {
        setErro('O servidor não respondeu como esperado. Tente de novo em instantes.');
        return;
      }
      const { token } = (await r.json()) as { token: string };
      // `signIn` limpa a organização guardada: ela é escolhida em seguida.
      signIn(token);
      const o = await fetch(`${API}/me/organizations`, { headers: { authorization: `Bearer ${token}` } });
      const lista = o.ok ? (((await o.json()) as { items?: Organizacao[] }).items ?? []) : [];
      if (lista.length === 0) {
        setErro('Sua conta não tem organização ativa. Fale com quem administra a prestadora.');
        return;
      }
      if (lista.length === 1) entrarNa(lista[0]!);
      else setOpcoes(lista);
    } catch {
      setErro('Sem conexão. Entrar exige rede uma vez — depois o aplicativo funciona sem sinal.');
    } finally {
      setEnviando(false);
    }
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const limpo = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) {
      setErro('Informe um endereço de e-mail válido.');
      return;
    }
    if (provedor === 'local') {
      if (!organizacao.trim()) {
        setErro('Informe a organização — é ela que decide qual dia baixar.');
        return;
      }
      signIn(`local:${limpo}:${limpo}`);
      chooseOrganization(organizacao.trim());
      void navigate({ to: '/' });
      return;
    }
    if (!senha) {
      setErro('Informe a sua senha.');
      return;
    }
    void entrarComSenha(limpo);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <div className="flex flex-col gap-5 p-6">
          <header className="flex flex-col items-center gap-2 text-center">
            <Logo
              src={MARCA.logoHorizontal}
              srcEscuro={MARCA.logoHorizontalEscuro}
              nome={MARCA.produto}
              largura={168}
              className="mx-auto mb-2"
            />
            <h1 className="text-xl font-semibold text-text">{MARCA.campo.nomeNaTela}</h1>
            <p className="text-sm text-muted">
              Entre uma vez, com rede. Depois disso o aplicativo funciona o dia inteiro sem sinal.
            </p>
          </header>

          {opcoes ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-text">Por qual organização você vai atender hoje?</p>
              <ul className="flex flex-col gap-2">
                {opcoes.map((o) => (
                  <li key={o.organization_id}>
                    <Button
                      variant="secondary"
                      className="min-h-12 w-full justify-start"
                      onClick={() => entrarNa(o)}
                    >
                      {o.name}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <form noValidate className="flex flex-col gap-5" onSubmit={enviar}>
              {erro && (
                <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
                  {erro}
                </p>
              )}

              <Field label="Seu e-mail" required>
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  value={email}
                  disabled={enviando}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@prestadora.com.br"
                  autoFocus
                  className="min-h-12"
                />
              </Field>

              {provedor === 'local' ? (
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
              ) : (
                <Field label="Senha" required hint="A mesma senha do sistema na web.">
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={senha}
                    disabled={enviando}
                    onChange={(e) => setSenha(e.target.value)}
                    className="min-h-12"
                  />
                </Field>
              )}

              <Button
                type="submit"
                variant="primary"
                className="min-h-12 w-full"
                disabled={enviando || provedor === null}
              >
                {enviando ? 'Entrando…' : 'Entrar'}
              </Button>

              {provedor === 'local' && (
                <p className="text-center text-xs text-subtle">
                  Ambiente de desenvolvimento: qualquer e-mail cadastrado entra sem senha. A API recusa este
                  modo fora de desenvolvimento.
                </p>
              )}
              {provedor === 'desconhecido' && (
                <p className="text-center text-xs text-subtle">
                  Não consegui falar com o servidor agora. Confira a conexão — entrar exige rede uma vez.
                </p>
              )}
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
