/**
 * Aurora — para onde um comando de banco PODE apontar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Em 2026-08-30 um projeto Supabase criado para o Aurora amanheceu com o schema
 * inteiro de outro produto dentro: 49 tabelas, 23 migrações e 9 jobs de cron que
 * não eram nossos. O comando que fez isso não era do Aurora — mas isso é sorte,
 * não desenho: até aqui, todo script de banco do Aurora aceitava qualquer
 * `DATABASE_URL` e ia trabalhar onde mandassem.
 *
 * A proteção que existia era pior do que nenhuma, porque parecia proteção:
 *
 *     if (/supabase\.co/.test(url) && !process.env.AURORA_CONFIRM_REMOTE) …
 *
 * Ela conferia se a variável ESTAVA DEFINIDA. Não conferia o valor. Exportar
 * `AURORA_CONFIRM_REMOTE=sim` liberava qualquer projeto do mundo — e quem
 * exportasse ficaria com a sensação de ter confirmado alguma coisa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DESENHO: LISTA FECHADA, E A DÚVIDA RECUSA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `aurora.destinos.json` enumera os destinos permitidos por ambiente. O que não
 * está lá é recusado. Não há modo de forçar, não há variável de escape, e é de
 * propósito: uma saída de emergência vira o caminho normal na primeira pressa.
 *
 * Três decisões que valem explicação:
 *
 *  1. AMBIENTE OBRIGATÓRIO PARA DESTINO REMOTO, dispensável para local.
 *     Exigir `AURORA_AMBIENTE` sempre quebraria `npm run db:migrate` contra o
 *     Postgres da própria máquina — e um guard que atrapalha o trabalho de todo
 *     dia é um guard que alguém desliga. Local é conferido pela lista; remoto
 *     exige que a pessoa DIGA para onde acha que está indo, e a intenção é
 *     conferida contra o destino.
 *
 *  2. O REF É EXTRAÍDO DA URL, e comparado. Duas formas aparecem na prática:
 *     `db.<ref>.supabase.co` (conexão direta) e `postgres.<ref>@…pooler…`
 *     (pooler, onde o ref viaja no NOME DE USUÁRIO). Ler só o host deixaria a
 *     segunda passar sem conferência — e é justamente a que mais se usa.
 *
 *  3. A LISTA DE BLOQUEADOS EXISTE ALÉM DA LISTA DE PERMITIDOS. Um ref
 *     desconhecido já seria recusado; um ref bloqueado é recusado COM O MOTIVO.
 *     A diferença é entre "não sei o que é isso" e "isto é o projeto que foi
 *     contaminado em agosto, e aqui está o documento". A segunda mensagem faz a
 *     pessoa parar; a primeira faz procurar como contornar.
 */

/** O que uma URL de banco realmente diz. */
export interface DestinoAnalisado {
  host: string;
  porta: number | null;
  banco: string;
  /** O ref do projeto Supabase, quando a URL é de um. */
  ref: string | null;
  /** `true` quando o destino não está nesta máquina. */
  remoto: boolean;
}

export interface AmbienteDeDestino {
  descricao?: string;
  hosts: string[];
  bancos: string[];
  ref: string | null;
  situacao?: string;
}

export interface ListaDeDestinos {
  ambientes: Record<string, AmbienteDeDestino>;
  bloqueados: Record<string, string>;
}

/** Recusa de destino. Sempre vira saída 1 — nunca é capturada e ignorada. */
export class DestinoRecusadoError extends Error {
  constructor(
    message: string,
    readonly motivo:
      | 'url_invalida'
      | 'ref_bloqueado'
      | 'ambiente_desconhecido'
      | 'ambiente_ausente'
      | 'ambiente_sem_destino'
      | 'fora_da_lista'
  ) {
    super(message);
    this.name = 'DestinoRecusadoError';
  }
}

const LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Lê a URL sem confiar nela.
 *
 * `new URL` aceita coisas que não são banco nenhum, então o que interessa é
 * extraído campo a campo e o resto é descartado. A SENHA NUNCA É LIDA e nunca
 * sai daqui — este módulo decide destino, não autentica.
 */
export function analisarDestino(url: string): DestinoAnalisado {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new DestinoRecusadoError(
      'DATABASE_URL não é uma URL válida. Nada é tentado com uma cadeia que não dá para ler.',
      'url_invalida'
    );
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) {
    throw new DestinoRecusadoError(
      `esperava uma URL postgres:// e veio "${u.protocol}//…". Recusado.`,
      'url_invalida'
    );
  }

  const host = u.hostname.toLowerCase();
  const banco = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';

  /*
   * O REF VEM DE DOIS LUGARES, e ignorar o segundo é o erro clássico.
   *
   *   conexão direta   db.<ref>.supabase.co        → está no host
   *   pooler           postgres.<ref>@…pooler…     → está no USUÁRIO
   *
   * O pooler é o que a interface do Supabase oferece primeiro, então é o que
   * aparece colado num terminal. Conferir só o host deixaria passar exatamente
   * a forma mais comum.
   */
  let ref: string | null = null;
  const porHost = host.match(/^(?:db\.)?([a-z0-9]{20})\.supabase\.co$/);
  if (porHost) ref = porHost[1]!;
  if (!ref) {
    const usuario = decodeURIComponent(u.username);
    const porUsuario = usuario.match(/^postgres\.([a-z0-9]{20})$/);
    if (porUsuario) ref = porUsuario[1]!;
  }

  return {
    host,
    porta: u.port ? Number(u.port) : null,
    banco,
    ref,
    remoto: !LOCAIS.has(host),
  };
}

export interface ConferenciaDeDestino {
  url: string;
  /** `AURORA_AMBIENTE`, quando definido. */
  ambiente?: string | undefined;
  lista: ListaDeDestinos;
}

/**
 * Decide se este comando pode falar com este banco.
 *
 * Devolve o ambiente resolvido em caso de sucesso; LANÇA em qualquer outro
 * caso. Não existe valor de retorno que signifique "não sei" — quem chama não
 * tem como confundir dúvida com permissão.
 */
export function conferirDestino(entrada: ConferenciaDeDestino): {
  ambiente: string;
  destino: DestinoAnalisado;
} {
  const destino = analisarDestino(entrada.url);

  /*
   * O BLOQUEIO VEM ANTES DE TUDO.
   *
   * Um ref bloqueado é recusado mesmo que alguém o acrescente à lista de
   * permitidos por engano — as duas listas teriam de ser editadas para liberá-lo,
   * e editar duas coisas é uma decisão, não um deslize.
   */
  if (destino.ref && entrada.lista.bloqueados[destino.ref]) {
    throw new DestinoRecusadoError(
      `DESTINO BLOQUEADO: projeto ${destino.ref}.\n\n${entrada.lista.bloqueados[destino.ref]}`,
      'ref_bloqueado'
    );
  }

  const ambientes = entrada.lista.ambientes;
  const ambiente = entrada.ambiente?.trim() || '';

  if (ambiente && !ambientes[ambiente]) {
    throw new DestinoRecusadoError(
      `AURORA_AMBIENTE="${ambiente}" não existe. Conhecidos: ${Object.keys(ambientes).join(', ')}.`,
      'ambiente_desconhecido'
    );
  }

  if (!ambiente) {
    /*
     * SEM AMBIENTE DECLARADO: só passa destino LOCAL, e só se a lista o
     * reconhecer. Remoto sem declaração é o caso que este arquivo existe para
     * impedir — a pessoa acha que está num lugar e está noutro.
     */
    if (destino.remoto) {
      throw new DestinoRecusadoError(
        `destino REMOTO (${destino.host}) sem AURORA_AMBIENTE definido.\n\n` +
          'Um comando remoto precisa dizer para onde acha que está indo, para que\n' +
          'a intenção possa ser conferida contra o destino. Defina AURORA_AMBIENTE.',
        'ambiente_ausente'
      );
    }
    const local = Object.entries(ambientes).find(
      ([, a]) => a.hosts.includes(destino.host) && a.bancos.includes(destino.banco)
    );
    if (!local) {
      throw new DestinoRecusadoError(naoEstaNaLista(destino, ambientes), 'fora_da_lista');
    }
    return { ambiente: local[0], destino };
  }

  const alvo = ambientes[ambiente]!;

  if (destino.remoto) {
    if (!alvo.ref) {
      throw new DestinoRecusadoError(
        `o ambiente "${ambiente}" não tem destino remoto configurado.\n\n` +
          (alvo.situacao ?? 'Nenhum projeto foi liberado para ele.') +
          '\n\nEnquanto `ref` for nulo em aurora.destinos.json, todo destino remoto\n' +
          'deste ambiente é recusado. É o comportamento desejado, não uma falha.',
        'ambiente_sem_destino'
      );
    }
    if (destino.ref !== alvo.ref) {
      throw new DestinoRecusadoError(
        `destino não confere com o ambiente.\n\n` +
          `  AURORA_AMBIENTE : ${ambiente}\n` +
          `  esperado        : ${alvo.ref}\n` +
          `  recebido        : ${destino.ref ?? '(a URL não revela ref de projeto)'}\n` +
          `  host            : ${destino.host}\n\n` +
          'A URL aponta para outro lugar. Nada foi tentado.',
        'fora_da_lista'
      );
    }
    return { ambiente, destino };
  }

  if (!alvo.hosts.includes(destino.host) || !alvo.bancos.includes(destino.banco)) {
    throw new DestinoRecusadoError(
      `destino local fora da lista do ambiente "${ambiente}".\n\n` +
        `  host recebido  : ${destino.host}\n` +
        `  banco recebido : ${destino.banco}\n` +
        `  hosts aceitos  : ${alvo.hosts.join(', ') || '(nenhum)'}\n` +
        `  bancos aceitos : ${alvo.bancos.join(', ') || '(nenhum)'}`,
      'fora_da_lista'
    );
  }

  return { ambiente, destino };
}

function naoEstaNaLista(d: DestinoAnalisado, ambientes: Record<string, AmbienteDeDestino>): string {
  const conhecidos = Object.entries(ambientes)
    .filter(([, a]) => a.hosts.length > 0)
    .map(([n, a]) => `  ${n}: ${a.hosts.join('/')} → ${a.bancos.join(', ')}`)
    .join('\n');
  return (
    `destino não está na lista de nenhum ambiente.\n\n` +
    `  host  : ${d.host}\n` +
    `  banco : ${d.banco}\n\n` +
    `Destinos locais conhecidos:\n${conhecidos}\n\n` +
    'Se este destino é legítimo, acrescente-o a aurora.destinos.json — de\n' +
    'propósito não existe variável de ambiente que contorne esta lista.'
  );
}
