/**
 * Téchne Care — o cliente da DEMONSTRAÇÃO.
 *
 * Implementa a mesma interface `ApiClient` do `@aurora/contracts` que o cliente
 * HTTP implementa — e por isso as telas não sabem que estão numa demonstração.
 * A diferença é uma só: em vez de `fetch`, ele responde com as respostas
 * gravadas em `capturas.json`.
 *
 * NENHUMA CHAMADA DE REDE SAI DAQUI. Não há `fetch`, não há URL base, não há
 * credencial: o arquivo de capturas entra no pacote no momento do build.
 *
 * DE ONDE VÊM AS RESPOSTAS
 *
 * De `npm run demo:capturar` (tools/demo): a API de verdade, em processo, sobre
 * um banco em memória com dados fictícios. Cada resposta é a que o produto
 * produziria — os campos calculados (SLA, indicadores, saldos) foram calculados
 * pelo servidor, e não escritos à mão.
 *
 * TRÊS AJUSTES NA LEITURA
 *
 * 1. Datas andam com o calendário. A captura foi feita num dia; a demonstração
 *    é aberta em outro. Toda data é deslocada pelo número de DIAS inteiros
 *    entre os dois — "agendada para hoje às 14h" continua sendo hoje às 14h, e
 *    a OS aberta há três dias continua tendo três dias.
 * 2. Filtros. Uma lista pedida com um filtro que não foi capturado (situação,
 *    natureza, local) é recortada aqui, pelo campo de mesmo nome.
 * 3. A busca global é resolvida sobre as listas capturadas.
 *
 * ESCRITA NÃO EXISTE. Todo comando (POST, PATCH, PUT, DELETE) é recusado com
 * uma mensagem que diz o que é: "disponível na versão conectada". As telas já
 * sabem mostrar uma recusa do servidor, e é exatamente isso que ela parece —
 * sem fingir que algo foi gravado.
 */
import { ApiError, type ApiClient, type OperationDefinition } from '@aurora/contracts';
import dados from './capturas.json';

interface Captura {
  op: string;
  params: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  body: unknown;
}

export const MENSAGEM_SEM_ESCRITA =
  'Disponível na versão conectada. Esta é uma demonstração: nenhuma alteração é gravada.';

/* ------------------------------------------------------------------ datas */

const ISO_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

/** Dias inteiros entre a data da captura e hoje, no fuso de quem abre. */
function diasDesdeACaptura(capturadoEm: string): number {
  const meiaNoite = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((meiaNoite(new Date()) - meiaNoite(new Date(capturadoEm))) / DIA_MS);
}

interface Relogio {
  dias: number;
  capturadoEm: number;
  agora: number;
}

/**
 * Campos que marcam o FUTURO combinado — janela de agenda, vencimento,
 * validade. Esses andam exatamente com o calendário: "hoje às 14h" continua
 * sendo hoje às 14h, mesmo que já sejam 16h.
 */
const PLANEJADO = /^(scheduled|starts|ends|due|window|valid|expires|next|planned)/;

function deslocar(valor: unknown, r: Relogio, chave = ''): unknown {
  if (typeof valor === 'string') {
    if (ISO_INSTANTE.test(valor)) {
      const t = Date.parse(valor);
      if (Number.isNaN(t)) return valor;
      let novo = t + r.dias * DIA_MS;
      /*
       * O que era PASSADO na captura continua passado. Um chamado aberto às
       * 23h da captura, deslocado em dias inteiros, cairia às 23h de hoje — e
       * quem abre a demonstração às 9h veria "aberto daqui a 14 horas".
       */
      if (!PLANEJADO.test(chave) && t <= r.capturadoEm && novo > r.agora) novo -= DIA_MS;
      return new Date(novo).toISOString();
    }
    if (ISO_DATA.test(valor)) {
      const t = Date.parse(`${valor}T12:00:00Z`);
      return Number.isNaN(t) ? valor : new Date(t + r.dias * DIA_MS).toISOString().slice(0, 10);
    }
    return valor;
  }
  if (Array.isArray(valor)) return valor.map((v) => deslocar(v, r, chave));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, deslocar(v, r, k)]));
  }
  return valor;
}

/* -------------------------------------------------------------- consultas */

const normalizar = (q: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries((q ?? {}) as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)])
  );

const mesmosParametros = (a: unknown, b: unknown) =>
  JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));

/** Chaves que mudam a forma da página, e não o conteúdo — nunca filtram. */
const PAGINACAO = new Set(['limit', 'cursor', 'offset', 'from', 'to', 'q']);

function recortar(body: unknown, filtros: Record<string, string>, limite?: number): unknown {
  const b = body as { items?: Array<Record<string, unknown>> };
  if (!b || !Array.isArray(b.items)) return body;
  let itens = b.items;
  for (const [chave, valor] of Object.entries(filtros)) {
    if (PAGINACAO.has(chave)) continue;
    const campo = [chave, `${chave}_id`, `${chave}_key`].find((c) => itens.some((i) => c in i));
    // Filtro sem campo correspondente é ignorado, e não zera a lista: uma
    // tela vazia por um filtro que a demonstração não sabe aplicar seria pior.
    if (campo) itens = itens.filter((i) => String(i[campo]) === valor);
  }
  if (limite && limite > 0) itens = itens.slice(0, limite);
  return { ...b, items: itens };
}

/* ------------------------------------------------------------------ busca */

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const COMANDOS = [
  { key: 'hoje', label: 'Hoje', action: '/', keywords: ['inicio', 'painel', 'dashboard'] },
  { key: 'solicitacoes', label: 'Solicitações', action: '/solicitacoes', keywords: ['chamados', 'triagem'] },
  { key: 'ordens', label: 'Ordens de serviço', action: '/ordens', keywords: ['os', 'kanban'] },
  { key: 'agenda', label: 'Agenda', action: '/agenda', keywords: ['programacao', 'calendario'] },
  { key: 'ativos', label: 'Ativos', action: '/ativos', keywords: ['equipamentos', 'parque'] },
  { key: 'estoque', label: 'Estoque', action: '/estoque', keywords: ['pecas', 'almoxarifado'] },
  { key: 'contratos', label: 'Contratos', action: '/contratos', keywords: ['comercial'] },
  { key: 'orcamentos', label: 'Orçamentos', action: '/orcamentos', keywords: ['propostas'] },
  { key: 'indicadores', label: 'Indicadores', action: '/indicadores', keywords: ['mttr', 'sla', 'kpi'] },
  {
    key: 'configuracoes',
    label: 'Configurações',
    action: '/configuracoes',
    keywords: ['pessoas', 'membros'],
  },
].map((c) => ({ ...c, permission: 'organization.read' }));

/* ---------------------------------------------------------------- cliente */

export function criarClienteDemo(espera = 120): ApiClient {
  const relogio: Relogio = {
    dias: diasDesdeACaptura(dados.capturedAt),
    capturadoEm: Date.parse(dados.capturedAt),
    agora: Date.now(),
  };
  const porOperacao = new Map<string, Captura[]>();
  for (const c of dados.capturas as unknown as Captura[]) {
    const lista = porOperacao.get(c.op) ?? [];
    lista.push({ ...c, body: deslocar(c.body, relogio) });
    porOperacao.set(c.op, lista);
  }

  const naoEncontrado = (op: OperationDefinition) =>
    new ApiError(404, {
      code: 'not_found',
      message: 'Este registro não existe na demonstração.',
      request_id: `demo-${op.operationId}`,
    });

  function ler(op: OperationDefinition, params: unknown, query: unknown): unknown {
    const pedidas = normalizar(query);
    const candidatas = (porOperacao.get(op.operationId) ?? []).filter((c) =>
      mesmosParametros(c.params, params)
    );
    if (candidatas.length === 0) throw naoEncontrado(op);

    // A captura cuja consulta mais se aproxima da pedida, sem contradizê-la.
    let melhor: Captura | undefined;
    let pontos = -1;
    for (const c of candidatas) {
      const q = normalizar(c.query);
      const chaves = Object.keys(q).filter((k) => !PAGINACAO.has(k));
      if (chaves.some((k) => pedidas[k] !== q[k])) continue;
      if (chaves.length > pontos) {
        melhor = c;
        pontos = chaves.length;
      }
    }
    const escolhida = melhor ?? candidatas[0]!;
    const jaAplicadas = normalizar(escolhida.query);
    const restantes = Object.fromEntries(Object.entries(pedidas).filter(([k]) => !(k in jaAplicadas)));
    return recortar(escolhida.body, restantes, pedidas.limit ? Number(pedidas.limit) : undefined);
  }

  function buscar(termoBruto: string) {
    const comandoMode = termoBruto.startsWith('>');
    const termo = semAcento(termoBruto.replace(/^>/, '').trim());
    const casa = (...textos: Array<unknown>) =>
      textos.some((t) => typeof t === 'string' && semAcento(t).includes(termo));

    const commands = COMANDOS.filter((c) => casa(c.label, ...c.keywords));
    const hits: Array<Record<string, unknown>> = [];
    if (!comandoMode && termo.length > 0) {
      const lista = (op: string) =>
        (
          (porOperacao.get(op) ?? []).find((c) => !normalizar(c.query).asset)?.body as {
            items?: Array<Record<string, unknown>>;
          }
        )?.items ?? [];

      for (const o of lista('workOrders.list')) {
        if (casa(o.number, o.title, o.asset_name_snapshot, o.location_name_snapshot)) {
          hits.push({
            scope: 'work_order',
            id: o.id,
            title: `${o.number} · ${o.title}`,
            subtitle: [o.status_label, o.asset_name_snapshot].filter(Boolean).join(' · ') || null,
            matchKind: semAcento(String(o.number)) === termo ? 'identifier_exact' : 'text',
            touchedAt: o.created_at ?? null,
          });
        }
      }
      for (const a of lista('assets.list')) {
        if (casa(a.name, a.asset_number, a.serial_number, a.tag, a.category_name, a.location_name)) {
          hits.push({
            scope: 'asset',
            id: a.id,
            title: a.name,
            subtitle: [a.asset_number, a.location_name].filter(Boolean).join(' · ') || null,
            matchKind: semAcento(String(a.asset_number)) === termo ? 'identifier_exact' : 'text',
            touchedAt: null,
          });
        }
      }
      for (const s of lista('serviceRequests.queue')) {
        if (casa(s.number, s.summary)) {
          hits.push({
            scope: 'service_request',
            id: s.id,
            title: `${s.number} · ${s.summary}`,
            subtitle: null,
            matchKind: semAcento(String(s.number)) === termo ? 'identifier_exact' : 'text',
            touchedAt: s.created_at ?? null,
          });
        }
      }
    }

    return {
      term: termoBruto,
      commandMode: comandoMode,
      commands,
      hits: hits.slice(0, 20),
      scopes: ['work_order', 'asset', 'service_request'],
      scopeLabels: { work_order: 'Ordens de serviço', asset: 'Ativos', service_request: 'Solicitações' },
    };
  }

  const responder = <T>(valor: () => T, signal?: AbortSignal): Promise<T> =>
    new Promise((ok, falha) => {
      /*
       * Uma espera curta, de propósito: sem ela os esqueletos de carregamento
       * nunca aparecem, e a demonstração mostraria uma interface que nunca
       * espera — que não é a que o cliente vai usar.
       */
      const t = setTimeout(() => {
        try {
          ok(valor());
        } catch (e) {
          falha(e);
        }
      }, espera);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        falha(new DOMException('cancelada', 'AbortError'));
      });
    });

  return {
    urlFor: (op) => `demo:${op.path}`,

    call(op, args) {
      const a = (args ?? {}) as { params?: unknown; query?: unknown; signal?: AbortSignal };

      // Sair sempre dá certo: não há sessão no servidor para encerrar.
      if (op.operationId === 'auth.logout') return responder(() => ({ ok: true }) as never);

      // Arquivo gerado na hora (PDF) não existe na demonstração: não há
      // servidor para gerá-lo. A recusa é a mesma de qualquer escrita.
      if (op.method !== 'GET' || op.produces) {
        return responder(() => {
          throw new ApiError(403, {
            code: 'forbidden',
            message: MENSAGEM_SEM_ESCRITA,
            request_id: `demo-${op.operationId}`,
          });
        });
      }

      if (op.operationId === 'search.global') {
        return responder(() => buscar(String(normalizar(a.query).q ?? '')) as never, a.signal);
      }

      return responder(() => structuredClone(ler(op, a.params, a.query)) as never, a.signal);
    },
  };
}
