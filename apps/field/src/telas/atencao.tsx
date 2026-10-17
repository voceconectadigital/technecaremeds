/**
 * Aurora — "Precisa da sua atenção" (SPEC v0.2 §20 · EPIC-014).
 *
 * A TELA QUE EXISTE PARA QUE NADA SUMA.
 *
 * Quando o servidor recusa um comando porque o mundo mudou — a OS foi
 * cancelada, o estado já não permite —, o trabalho que a pessoa escreveu não
 * pode simplesmente virar um erro e desaparecer. Ele fica aqui, INTEIRO, até
 * alguém decidir o que fazer com ele.
 *
 * TRÊS COISAS QUE ESTA TELA PRECISA MOSTRAR, E MOSTRA:
 *
 *   1. O QUE ACONTECEU, em português. "A OS foi cancelada às 14h12 por Ana" —
 *      e não "erro 409", que não conta nada a ninguém.
 *   2. O QUE ELE TINHA ESCRITO, palavra por palavra. Pedir que ele lembre o
 *      diagnóstico de duas horas atrás é pedir uma versão pior do que ele
 *      escreveu.
 *   3. O QUE FAZER, com as duas saídas nomeadas — e nenhuma delas sendo um
 *      botão de "sumir com isto".
 */
import { useEffect, useState } from 'react';
import { useCampo } from '../campo';
import type { ComandoNaFila, PendenciaDeAtencao } from '../fila';

const QUANDO = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** O corpo do comando, legível. Um `<pre>` de JSON não é para o técnico. */
function Trabalho({ corpo }: { corpo: unknown }) {
  if (!corpo || typeof corpo !== 'object') return null;
  const campos = Object.entries(corpo as Record<string, unknown>).filter(
    ([k, v]) => v !== null && v !== undefined && v !== '' && !OCULTOS.has(k) && !ehTecnico(v)
  );
  if (campos.length === 0) return null;

  return (
    <dl className="mt-2 flex flex-col gap-1 rounded-control bg-surface-sunken p-2">
      {campos.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-xs font-medium text-subtle">{ROTULOS[k] ?? k}</dt>
          <dd className="text-sm text-text">{legivel(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * O QUE NÃO É DA PESSOA: identificadores, resumos criptográficos, tamanhos.
 *
 * A tela de conflito mostrava `attachment_id`, `sha256` e `item_id` crus — um
 * UUID e sessenta e quatro letras de hexadecimal na frente de quem está tentando
 * decidir o que fazer com o próprio trabalho. Eles continuam no comando (é o
 * que vai ao servidor); só não aparecem aqui.
 */
const OCULTOS = new Set([
  'item_id',
  'attachment_id',
  'warehouse_id',
  'template_id',
  'response_id',
  'asset_id',
  'location_id',
  'sha256',
  'byte_size',
  'content_type',
  'storage_key',
  'signer_role',
  'method',
]);

/** Valor que, mesmo sob um nome desconhecido, é identificador e não texto. */
function ehTecnico(v: unknown): boolean {
  if (typeof v === 'string') {
    return (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || /^[0-9a-f]{32,}$/i.test(v)
    );
  }
  // A referência ao anexo ainda não registrado (`{ $anexoLocal }`).
  return typeof v === 'object' && v !== null && '$anexoLocal' in v;
}

function legivel(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
  return typeof v === 'number' ? String(v) : JSON.stringify(v);
}

/**
 * Os nomes que a pessoa reconhece.
 *
 * `resolution` é um nome de coluna; "o que foi feito" é o que ela digitou. A
 * tela de conflito é o pior lugar possível para mostrar vocabulário de banco:
 * quem está lendo já está lidando com um problema.
 */
const ROTULOS: Record<string, string> = {
  to: 'Mudança pedida',
  resolution: 'O que foi feito',
  wait_note: 'Observação da espera',
  cancellation_reason: 'Motivo do cancelamento',
  note: 'Observação',
  started_at: 'Início',
  ended_at: 'Fim',
  qty: 'Quantidade',
  boolean: 'Resposta',
  number: 'Resposta',
  text: 'Resposta',
  options: 'Resposta',
  date: 'Resposta',
  photo_count: 'Fotos',
  signer_name: 'Quem assinou',
  signer_document: 'Documento de quem assinou',
  purpose: 'Finalidade',
  file_name: 'Arquivo',
};

export function AtencaoPage() {
  const { fila, resolverAtencao, desbloquear, descartar, estado } = useCampo();
  const [pendencias, setPendencias] = useState<PendenciaDeAtencao[]>([]);
  const [parados, setParados] = useState<ComandoNaFila[]>([]);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void Promise.all([fila.listarAtencao(), fila.listar()]).then(([a, c]) => {
      if (!vivo) return;
      setPendencias(a);
      setParados(c.filter((x) => x.bloqueado && fila.daSessaoAtual(x)));
    });
    return () => {
      vivo = false;
    };
  }, [fila, estado.atencao, estado.bloqueados, estado.pendentes]);

  /*
   * OS PARADOS SEM PENDÊNCIA À FRENTE — os "órfãos".
   *
   * Aparecem depois de "Já resolvi de outro jeito": a pendência sai, e o que
   * vinha depois dela fica parado de propósito. A primeira versão desta tela só
   * listava pendências — então a sincronização dizia "esperando a sua decisão
   * (2)" e esta tela dizia "nada parado", e os dois comandos ficavam presos sem
   * nenhum botão no aplicativo inteiro que os soltasse ou descartasse.
   */
  const comPendencia = new Set(pendencias.map((p) => p.agregado));
  const orfaos = new Map<string, ComandoNaFila[]>();
  for (const c of parados) {
    if (comPendencia.has(c.agregado)) continue;
    orfaos.set(c.agregado, [...(orfaos.get(c.agregado) ?? []), c]);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">Precisa da sua atenção</h1>

      {orfaos.size > 0 && (
        <section aria-labelledby="orfaos" className="flex flex-col gap-3">
          <h2 id="orfaos" className="text-sm font-semibold text-text">
            Ações paradas esperando você
          </h2>
          <p className="text-sm text-muted">
            Ficaram paradas depois que você resolveu um problema desta ordem de outro jeito. Solte para
            enviar, ou descarte o que não vale mais.
          </p>
          {[...orfaos].map(([agregado, comandos]) => (
            <div key={agregado} className="rounded-panel border border-border-strong bg-surface p-3">
              <ul className="flex flex-col gap-2">
                {comandos.map((c) => (
                  <li key={c.id} className="flex flex-col">
                    <p className="text-sm font-medium text-text">{c.rotulo}</p>
                    <Trabalho corpo={c.corpo} />
                    {confirmando === c.id ? (
                      <div className="mt-2 rounded-control border border-danger p-2">
                        <p className="text-xs text-text">
                          Isto apaga do aparelho esta ação. Não dá para recuperar depois.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void descartar(c.id).then(() => setConfirmando(null))}
                            className="min-h-11 flex-1 rounded-control bg-danger px-3 text-sm font-medium text-on-danger"
                          >
                            Apagar mesmo assim
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmando(null)}
                            className="min-h-11 flex-1 rounded-control border border-border-subtle px-3 text-sm text-text"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmando(c.id)}
                        className="mt-1 min-h-11 self-start rounded-control px-3 text-xs text-subtle"
                      >
                        Descartar esta ação
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void desbloquear(agregado)}
                className="mt-3 min-h-12 w-full rounded-control border border-border-subtle bg-surface px-3 text-sm font-medium text-text"
              >
                {comandos.length === 1 ? 'Soltar para enviar' : `Soltar as ${comandos.length} para enviar`}
              </button>
            </div>
          ))}
        </section>
      )}

      {pendencias.length === 0 && orfaos.size > 0 ? null : pendencias.length === 0 ? (
        <div className="rounded-panel border border-border-subtle bg-surface p-4">
          <p className="text-sm font-medium text-text">Nada parado</p>
          <p className="mt-1 text-sm text-muted">
            Quando o servidor recusar alguma coisa que você fez — porque a ordem mudou enquanto você estava
            sem rede —, ela aparece aqui com tudo que você escreveu. Nada é jogado fora.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {pendencias.map((p) => {
            const bloqueadosDaMesma = parados.filter((c) => c.agregado === p.agregado);
            return (
              <li
                key={p.id}
                className="rounded-panel border border-border-strong bg-surface p-3"
                aria-labelledby={`conflito-${p.id}`}
              >
                <h2 id={`conflito-${p.id}`} className="text-sm font-semibold text-text">
                  {p.rotulo}
                </h2>
                <p className="mt-0.5 text-xs text-subtle">
                  Recusado em {QUANDO.format(new Date(p.recusadoEm))}
                </p>
                <p className="mt-2 text-sm text-danger">{p.mensagem}</p>

                <Trabalho corpo={p.corpo} />

                {bloqueadosDaMesma.length > 0 && (
                  <p className="mt-2 text-xs text-muted">
                    {bloqueadosDaMesma.length === 1
                      ? 'Outra ação desta ordem está parada esperando esta decisão.'
                      : `Outras ${bloqueadosDaMesma.length} ações desta ordem estão paradas esperando esta decisão.`}
                  </p>
                )}

                <div className="mt-3 flex flex-col gap-2">
                  {/*
                    AS DUAS SAÍDAS, NOMEADAS PELO QUE FAZEM.

                    "Tentar de novo" devolve à fila o comando recusado — com o
                    mesmo identificador e na mesma posição, à frente do que
                    estava parado atrás dele — e solta o resto: serve quando a
                    pessoa resolveu a causa (ou entrou de novo, depois de um
                    403). "Já resolvi de outro jeito"
                    fecha a pendência e DEIXA o resto parado, porque quem decidiu
                    que não vale mais não quer que o resto siga sozinho.
                  */}
                  <button
                    type="button"
                    onClick={() => void resolverAtencao(p.id, { desbloquear: true })}
                    className="min-h-12 rounded-control border border-border-subtle bg-surface px-3 text-sm font-medium text-text"
                  >
                    Tentar de novo agora
                  </button>
                  <button
                    type="button"
                    onClick={() => void resolverAtencao(p.id, { desbloquear: false })}
                    className="min-h-12 rounded-control px-3 text-sm text-muted"
                  >
                    Já resolvi de outro jeito
                  </button>

                  {/*
                    O DESCARTE PEDE CONFIRMAÇÃO, e a confirmação diz o que se
                    perde. É o único caminho pelo qual trabalho não enviado
                    deixa de existir neste aplicativo, e ele exige dois toques
                    de gente numa tela que mostra o que está sendo jogado fora.
                  */}
                  {confirmando === p.id ? (
                    <div className="rounded-control border border-danger p-2">
                      <p className="text-xs text-text">
                        Isto apaga do aparelho o que você escreveu acima. Não dá para recuperar depois.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void descartar(p.id).then(() => setConfirmando(null))}
                          className="min-h-11 flex-1 rounded-control bg-danger px-3 text-sm font-medium text-on-danger"
                        >
                          Apagar mesmo assim
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmando(null)}
                          className="min-h-11 flex-1 rounded-control border border-border-subtle px-3 text-sm text-text"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmando(p.id)}
                      className="min-h-11 rounded-control px-3 text-xs text-subtle"
                    >
                      Descartar este trabalho
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
