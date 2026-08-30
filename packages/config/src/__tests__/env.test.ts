import { describe, it, expect } from 'vitest';
import { loadEnv, describe as describeEnv, ConfigurationError } from '../env';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/aurora' };

describe('validação de configuração (EPIC-001)', () => {
  it('aplica padrões seguros', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.AURORA_DB_APP_ROLE).toBe('aurora_app');
    expect(env.AURORA_ALLOW_UNSAFE_DEV).toBe(false);
  });

  it('falha alto quando falta variável obrigatória', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(ConfigurationError);
  });

  it('exige credenciais quando o provider é supabase', () => {
    expect(() => loadEnv({ ...base, AURORA_AUTH_PROVIDER: 'supabase' } as NodeJS.ProcessEnv)).toThrow(
      /AURORA_SUPABASE_URL/
    );
  });

  it('exige credenciais completas quando o storage é s3', () => {
    expect(() => loadEnv({ ...base, AURORA_STORAGE_DRIVER: 's3' } as NodeJS.ProcessEnv)).toThrow(
      /AURORA_S3_BUCKET/
    );
  });

  it('recusa nome de papel inválido — defesa contra injeção em SET ROLE', () => {
    expect(() => loadEnv({ ...base, AURORA_DB_APP_ROLE: 'app; DROP TABLE x' } as NodeJS.ProcessEnv)).toThrow(
      /papel inválido/
    );
  });

  it('proíbe modo inseguro em produção', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', AURORA_ALLOW_UNSAFE_DEV: 'true' } as NodeJS.ProcessEnv)
    ).toThrow(/não pode estar ativo em produção/);
  });

  it('diagnóstico nunca imprime segredo', () => {
    const env = loadEnv({
      ...base,
      AURORA_SUPABASE_SERVICE_ROLE_KEY: 'chave-super-secreta',
    } as NodeJS.ProcessEnv);
    const out = describeEnv(env);
    expect(out.DATABASE_URL).toBe('<definido>');
    expect(out.AURORA_SUPABASE_SERVICE_ROLE_KEY).toBe('<definido>');
    expect(JSON.stringify(out)).not.toContain('chave-super-secreta');
    expect(JSON.stringify(out)).not.toContain('localhost:5432');
  });
});

describe('os quatro ambientes, e as travas do que é exposto', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/aurora',
    AURORA_DB_APP_ROLE: 'aurora_app',
  } as unknown as NodeJS.ProcessEnv;

  it('o padrão é desenvolvimento — e desenvolvimento não é exposto', () => {
    const out = loadEnv({ ...base });
    expect(out.AURORA_AMBIENTE).toBe('desenvolvimento');
  });

  it('`NODE_ENV` e `AURORA_AMBIENTE` são perguntas diferentes, e podem divergir', () => {
    /*
     * É EXATAMENTE A COMBINAÇÃO DE UMA HOMOLOGAÇÃO: build de produção, dados de
     * teste. Sem as duas variáveis, "é produção?" e "foi compilado como
     * produção?" viram a mesma pergunta — e a resposta errada libera num
     * ambiente o que só podia valer no outro.
     */
    const out = loadEnv({
      ...base,
      NODE_ENV: 'production',
      AURORA_AMBIENTE: 'homologacao',
      AURORA_AUTH_PROVIDER: 'supabase',
      AURORA_SUPABASE_URL: 'https://exemplo.supabase.co',
      AURORA_SUPABASE_ANON_KEY: 'chave-anonima-de-teste',
    } as unknown as NodeJS.ProcessEnv);

    expect(out.NODE_ENV).toBe('production');
    expect(out.AURORA_AMBIENTE).toBe('homologacao');
  });

  it('homologação RECUSA o atalho de desenvolvimento', () => {
    /*
     * Uma homologação é acessada pelo cliente, por uma rede que não é a nossa.
     * `AURORA_ALLOW_UNSAFE_DEV` aceita entrar com qualquer e-mail, sem senha —
     * e um ambiente assim, exposto, com dado que alguém achou que era de
     * mentira, é o desastre clássico.
     */
    expect(() =>
      loadEnv({
        ...base,
        AURORA_AMBIENTE: 'homologacao',
        AURORA_ALLOW_UNSAFE_DEV: 'true',
        AURORA_AUTH_PROVIDER: 'supabase',
        AURORA_SUPABASE_URL: 'https://exemplo.supabase.co',
        AURORA_SUPABASE_ANON_KEY: 'chave-anonima-de-teste',
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/ambiente exposto/);
  });

  it('homologação RECUSA o provedor de identidade local', () => {
    // A mesma porta, por outro caminho: o provedor local entra sem senha.
    expect(() =>
      loadEnv({ ...base, AURORA_AMBIENTE: 'homologacao' } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/provedor real/);
  });

  it('produção recusa as mesmas duas coisas', () => {
    expect(() => loadEnv({ ...base, AURORA_AMBIENTE: 'producao' } as unknown as NodeJS.ProcessEnv)).toThrow(
      /provedor real/
    );
  });

  it('desenvolvimento e teste continuam podendo usar o provedor local', () => {
    // Se a trava valesse aqui, a suíte inteira e a máquina de quem desenvolve
    // precisariam de um provedor externo para subir a API.
    for (const ambiente of ['desenvolvimento', 'teste'] as const) {
      const out = loadEnv({
        ...base,
        AURORA_AMBIENTE: ambiente,
        AURORA_ALLOW_UNSAFE_DEV: 'true',
      } as unknown as NodeJS.ProcessEnv);
      expect(out.AURORA_AUTH_PROVIDER).toBe('local');
    }
  });
});
