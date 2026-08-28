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
