/**
 * Aurora — qual provedor de identidade este processo usa (SPEC v0.2 §36).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO NASCEU DE UM DEFEITO REAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `AURORA_AUTH_PROVIDER` existia na configuração, era validada, e NINGUÉM A
 * LIA. O `app.module` construía `LocalAuthProvider` sempre que nenhum provedor
 * fosse injetado, e `main.ts` nunca injetava nenhum.
 *
 * O efeito era o pior possível para uma variável de segurança: definir
 * `AURORA_AUTH_PROVIDER=supabase` fazia o boot passar — a validação exigia URL e
 * chave, e elas estavam lá — e o processo continuava aceitando
 * `local:<sujeito>:<e-mail>`, que entra sem senha. A configuração dizia uma
 * coisa e o processo fazia outra, e nada acusava.
 *
 * Agora a escolha é explícita, está num lugar só, e o caso desconhecido LANÇA.
 * Um `switch` com `default` que devolve o provedor local seria a mesma
 * armadilha, escrita de novo.
 */
import type { Database } from '@aurora/db';
import type { AuroraEnv } from '@aurora/config';
import { LocalAuthProvider, type AuthProvider } from './auth-provider.port';
import { PasswordAuthProvider } from './password-auth-provider';

export function escolherProvedorDeAutenticacao(env: AuroraEnv, db: Database): AuthProvider {
  switch (env.AURORA_AUTH_PROVIDER) {
    case 'password':
      return new PasswordAuthProvider(db);

    case 'local':
      /*
       * O provedor local existe para a suíte e para a máquina de quem
       * desenvolve. A configuração já o recusa em homologação e em produção
       * (`env.ts`), e o construtor recusa de novo pelo modo de execução: duas
       * travas para a mesma porta, porque é a porta que entra sem senha.
       */
      return new LocalAuthProvider(env.NODE_ENV !== 'production' || env.AURORA_ALLOW_UNSAFE_DEV);

    case 'supabase':
      /*
       * NÃO IMPLEMENTADO, e recusado em voz alta.
       *
       * O adaptador do Supabase Auth continua sendo um caminho previsto — a
       * porta existe para ele. O que não existe é acesso ao projeto: a conta
       * autenticada lista 28 projetos e nenhum é identificável como o do Aurora
       * (ADR-025, OQ-16). Escrever o adaptador sem poder exercitá-lo entregaria
       * um caminho de autenticação que ninguém verificou — e a primeira vez que
       * ele rodaria de verdade seria na frente do cliente.
       *
       * Falhar no boot é o comportamento certo. Cair no provedor local aqui
       * seria repetir exatamente o defeito que este arquivo corrige.
       */
      throw new Error(
        'AURORA_AUTH_PROVIDER=supabase ainda não tem adaptador implementado.\n' +
          'O acesso ao projeto Supabase do Aurora está bloqueado (ADR-025, OQ-16) e um\n' +
          'adaptador que ninguém pode exercitar não entra em uso.\n\n' +
          'Use AURORA_AUTH_PROVIDER=password — identidade real, senha própria, sessão\n' +
          'revogável. Ver docs/AI-HANDOFF.md §7.'
      );

    default: {
      // Exaustividade conferida em tempo de compilação: um valor novo no enum
      // sem tratamento aqui deixa de compilar, em vez de virar provedor local.
      const desconhecido: never = env.AURORA_AUTH_PROVIDER;
      throw new Error(`provedor de autenticação desconhecido: ${String(desconhecido)}`);
    }
  }
}
