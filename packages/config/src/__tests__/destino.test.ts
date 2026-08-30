/**
 * Aurora — a lista fechada de destinos de banco.
 *
 * O QUE ESTES CASOS PROTEGEM
 *
 * O acidente de 2026-08-30 — um projeto Supabase do Aurora recebendo o schema
 * de outro produto — não foi causado por um comando do Aurora. Mas foi possível
 * porque nenhum comando do Aurora conferia o destino. Estes casos garantem que
 * a conferência existe, que ela recusa por padrão, e que ela não tem porta dos
 * fundos.
 *
 * O caso mais importante é o do POOLER: o ref viaja no nome de usuário, não no
 * host, e é a forma que a interface do Supabase oferece primeiro — logo, é a
 * que aparece colada num terminal às pressas.
 */
import { describe, it, expect } from 'vitest';
import { analisarDestino, conferirDestino, DestinoRecusadoError, type ListaDeDestinos } from '../destino';

const LISTA: ListaDeDestinos = {
  ambientes: {
    desenvolvimento: {
      hosts: ['localhost', '127.0.0.1'],
      bancos: ['aurora', 'aurora_dev', 'postgres'],
      ref: null,
    },
    teste: {
      hosts: ['localhost', '127.0.0.1'],
      bancos: ['aurora_e2e', 'aurora_test'],
      ref: null,
    },
    homologacao: {
      hosts: [],
      bancos: [],
      ref: null,
      situacao: 'SEM DESTINO. Nenhum projeto Supabase do Aurora existe.',
    },
    producao: { hosts: [], bancos: [], ref: null },
  },
  bloqueados: {
    egoajboqzhnvkpenrszw: 'Contaminado em 2026-08-30 pelo E-commerce Template.',
    ikzpateoicbjxkapdtsd: 'Projeto de terceiro.',
  },
};

const local = (banco: string) => `postgresql://u:s@localhost:5432/${banco}`;

describe('DESTINO-001 · o ref é lido das DUAS formas', () => {
  it('conexão direta: o ref está no host', () => {
    const d = analisarDestino('postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres');
    expect(d.ref).toBe('abcdefghijklmnopqrst');
    expect(d.remoto).toBe(true);
  });

  it('POOLER: o ref está no NOME DE USUÁRIO, e é onde quase todo mundo cola', () => {
    /*
     * É a forma que a interface do Supabase oferece primeiro. Um guard que
     * olhasse só o host acharia `aws-0-sa-east-1.pooler.supabase.com` — um host
     * genérico, igual para milhares de projetos — e não teria o que conferir.
     */
    const d = analisarDestino(
      'postgresql://postgres.abcdefghijklmnopqrst:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
    );
    expect(d.ref).toBe('abcdefghijklmnopqrst');
    expect(d.remoto).toBe(true);
  });

  it('destino local não tem ref e é reconhecido como local', () => {
    const d = analisarDestino(local('aurora'));
    expect(d.ref).toBeNull();
    expect(d.remoto).toBe(false);
    expect(d.banco).toBe('aurora');
  });

  it('uma URL que não é postgres é recusada, e nada é tentado', () => {
    expect(() => analisarDestino('https://exemplo.test/banco')).toThrow(DestinoRecusadoError);
    expect(() => analisarDestino('nem-url')).toThrow(/não é uma URL válida/);
  });
});

describe('DESTINO-002 · o projeto contaminado é recusado COM O MOTIVO', () => {
  const contaminado = 'egoajboqzhnvkpenrszw';

  it('pela conexão direta', () => {
    expect(() =>
      conferirDestino({
        url: `postgresql://postgres:x@db.${contaminado}.supabase.co:5432/postgres`,
        lista: LISTA,
      })
    ).toThrow(/BLOQUEADO.*Contaminado/s);
  });

  it('pelo pooler — a forma que passaria despercebida', () => {
    expect(() =>
      conferirDestino({
        url: `postgresql://postgres.${contaminado}:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`,
        lista: LISTA,
        ambiente: 'homologacao',
      })
    ).toThrow(/BLOQUEADO/);
  });

  it('o bloqueio vence mesmo se alguém puser o ref como destino do ambiente', () => {
    /*
     * Liberar um projeto bloqueado exige editar DUAS listas. Editar duas coisas
     * é uma decisão; editar uma é um deslize.
     */
    const listaAdulterada: ListaDeDestinos = {
      ...LISTA,
      ambientes: { ...LISTA.ambientes, homologacao: { hosts: [], bancos: [], ref: contaminado } },
    };
    expect(() =>
      conferirDestino({
        url: `postgresql://postgres:x@db.${contaminado}.supabase.co:5432/postgres`,
        ambiente: 'homologacao',
        lista: listaAdulterada,
      })
    ).toThrow(/BLOQUEADO/);
  });
});

describe('DESTINO-003 · remoto sem ambiente declarado NÃO passa', () => {
  it('é o caso que o acidente exigiria: achar que está num lugar e estar noutro', () => {
    expect(() =>
      conferirDestino({
        url: 'postgresql://postgres:x@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres',
        lista: LISTA,
      })
    ).toThrow(/sem AURORA_AMBIENTE/);
  });

  it('e um ambiente sem destino configurado recusa, explicando', () => {
    expect(() =>
      conferirDestino({
        url: 'postgresql://postgres:x@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres',
        ambiente: 'homologacao',
        lista: LISTA,
      })
    ).toThrow(/não tem destino remoto configurado[\s\S]*SEM DESTINO/);
  });

  it('ref que não bate com o do ambiente recusa, mostrando os dois', () => {
    const lista: ListaDeDestinos = {
      ...LISTA,
      ambientes: {
        ...LISTA.ambientes,
        homologacao: { hosts: [], bancos: [], ref: 'aaaaaaaaaaaaaaaaaaaa' },
      },
    };
    expect(() =>
      conferirDestino({
        url: 'postgresql://postgres:x@db.bbbbbbbbbbbbbbbbbbbb.supabase.co:5432/postgres',
        ambiente: 'homologacao',
        lista,
      })
    ).toThrow(/esperado[\s\S]*aaaaaaaaaaaaaaaaaaaa[\s\S]*recebido[\s\S]*bbbbbbbbbbbbbbbbbbbb/);
  });

  it('o destino remoto CERTO passa', () => {
    const lista: ListaDeDestinos = {
      ...LISTA,
      ambientes: {
        ...LISTA.ambientes,
        homologacao: { hosts: [], bancos: [], ref: 'aaaaaaaaaaaaaaaaaaaa' },
      },
    };
    const r = conferirDestino({
      url: 'postgresql://postgres.aaaaaaaaaaaaaaaaaaaa:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
      ambiente: 'homologacao',
      lista,
    });
    expect(r.ambiente).toBe('homologacao');
    expect(r.destino.ref).toBe('aaaaaaaaaaaaaaaaaaaa');
  });
});

describe('DESTINO-004 · o trabalho de todo dia continua funcionando', () => {
  it('local conhecido passa SEM exigir AURORA_AMBIENTE', () => {
    /*
     * Um guard que atrapalha o trabalho de todo dia é um guard que alguém
     * desliga. O aperto é no remoto, que é onde o dano mora.
     */
    expect(conferirDestino({ url: local('aurora'), lista: LISTA }).ambiente).toBe('desenvolvimento');
    expect(conferirDestino({ url: local('aurora_e2e'), lista: LISTA }).ambiente).toBe('teste');
  });

  it('local com ambiente declarado confere host E banco', () => {
    expect(conferirDestino({ url: local('aurora_e2e'), ambiente: 'teste', lista: LISTA }).ambiente).toBe(
      'teste'
    );
    expect(() =>
      conferirDestino({ url: local('aurora_e2e'), ambiente: 'desenvolvimento', lista: LISTA })
    ).toThrow(/fora da lista do ambiente "desenvolvimento"/);
  });

  it('banco local desconhecido é recusado, e a mensagem diz o que é aceito', () => {
    expect(() => conferirDestino({ url: local('banco_de_outro_produto'), lista: LISTA })).toThrow(
      /não está na lista[\s\S]*Destinos locais conhecidos/
    );
  });

  it('ambiente inventado é recusado listando os que existem', () => {
    expect(() => conferirDestino({ url: local('aurora'), ambiente: 'staging', lista: LISTA })).toThrow(
      /não existe. Conhecidos: desenvolvimento, teste, homologacao, producao/
    );
  });
});

describe('DESTINO-005 · não existe porta dos fundos', () => {
  it('nenhuma variável de ambiente contorna a lista', () => {
    /*
     * A versão anterior deste guard conferia se `AURORA_CONFIRM_REMOTE` estava
     * DEFINIDA — não o valor. `AURORA_CONFIRM_REMOTE=sim` liberava qualquer
     * projeto do mundo, e quem exportasse ficaria com a sensação de ter
     * confirmado alguma coisa.
     *
     * A superfície desta função é `{url, ambiente, lista}`. Ela não lê
     * `process.env` para nada. Não há o que exportar.
     */
    const antes = { ...process.env };
    process.env.AURORA_CONFIRM_REMOTE = 'sim';
    process.env.AURORA_FORCE = '1';
    process.env.AURORA_SKIP_DESTINO = 'true';
    try {
      expect(() =>
        conferirDestino({
          url: 'postgresql://postgres:x@db.egoajboqzhnvkpenrszw.supabase.co:5432/postgres',
          ambiente: 'homologacao',
          lista: LISTA,
        })
      ).toThrow(/BLOQUEADO/);
    } finally {
      process.env = antes;
    }
  });
});
