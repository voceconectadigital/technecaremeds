/**
 * Aurora — executar a ordem inteira, com ou sem rede (SPEC §20 · EPIC-014).
 *
 * TODO BOTÃO DESTA TELA ENFILEIRA. Nenhum espera resposta do servidor.
 *
 * É a diferença entre um aplicativo de campo e um site que abre no celular. Um
 * botão que espera resposta trava a tela no subsolo, e o técnico fica olhando um
 * giro por trinta segundos até desistir — e o que ele fez naquele momento não
 * existe em lugar nenhum.
 *
 * Aqui o toque grava LOCALMENTE e volta na hora. A tela mostra o estado como ele
 * ficou, e o indicador do topo diz quantas coisas ainda não chegaram ao servidor.
 *
 * O QUE É COMANDO E O QUE É RASCUNHO
 *
 * Tocar "iniciar", responder um item, consumir uma peça, assinar, concluir — são
 * COMANDOS: vão para a fila no instante do toque, e a fila garante que chegam.
 *
 * O texto do diagnóstico enquanto está sendo digitado é RASCUNHO: enfileirar
 * cada tecla produziria centenas de operações para uma frase que ainda não
 * terminou. Ele vai para a coleção de rascunhos, que sobrevive ao aplicativo ser
 * derrubado pelo sistema — e vira comando quando a pessoa conclui.
 *
 * A distinção é o que faz a promessa do épico ser cumprível: fechar o aplicativo
 * no meio da OS, reabrir ainda offline, e tudo continuar lá.
 *
 * TUDO NUMA TELA SÓ, E ROLANDO.
 *
 * Abas esconderiam o que falta atrás de um toque, e "o que falta" é a pergunta
 * que o técnico faz o tempo todo. Num corredor, rolar é mais barato do que
 * decidir em qual aba está a coisa.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Camera, CircleCheck, Package, Timer } from 'lucide-react';
import { limparRascunhos, useCampo, useColecaoLocal, useRascunho } from '../campo';
import type { AnexoPendente } from '../arquivos';
import { referenciaAoAnexo } from '../anexos';
import { Assinatura } from './assinatura';

interface OrdemLocal {
  id: string;
  number: string | null;
  title: string;
  description: string | null;
  status_key: string;
  status_label: string;
  category: string;
  asset_id: string | null;
  asset_name_snapshot: string | null;
  location_name_snapshot: string | null;
}

interface TransicaoLocal {
  from_key: string;
  to_key: string;
  required_fields: unknown;
}

interface SituacaoLocal {
  key: string;
  label: string;
}

interface ItemDeChecklist {
  id: string;
  label: string;
  kind: string;
  required: boolean;
  options: string[] | null;
  unit: string | null;
  position: number;
}

interface ModeloDeChecklist {
  id: string;
  key: string;
  title: string;
  items: ItemDeChecklist[];
}

interface SaldoLocal {
  item_id: string;
  warehouse_id: string;
  sku: string;
  name: string;
  unit: string;
  on_hand: string;
  warehouse_name: string;
}

export function OrdemPage() {
  /*
   * `strict: false` porque `from` é o CAMINHO e `useParams` quer o ID DA ROTA.
   * Sob a rota-casca os dois deixam de coincidir, e o erro não aparece como
   * aviso de tipo: aparece como a tela inteira caindo no limite de erro do
   * roteador. Foi assim que apareceu aqui.
   */
  const { id } = useParams({ strict: false }) as { id: string };
  const { enfileirar, capturarFoto, anexarBytes, estado, anexos, base } = useCampo();

  const { linhas: ordens, carregando } = useColecaoLocal<OrdemLocal>('ordens');
  const { linhas: transicoes } = useColecaoLocal<TransicaoLocal>('transicoes');
  const { linhas: situacoes } = useColecaoLocal<SituacaoLocal>('situacoes');
  const { linhas: modelos } = useColecaoLocal<ModeloDeChecklist>('checklists');
  const { linhas: estoque } = useColecaoLocal<SaldoLocal>('estoque');

  const [diagnostico, setDiagnostico] = useRascunho(`os:${id}:diagnostico`);
  const [resolucao, setResolucao] = useRascunho(`os:${id}:resolucao`);
  const [nomeAssina, setNomeAssina] = useRascunho(`os:${id}:assina-nome`);
  const [docAssina, setDocAssina] = useRascunho(`os:${id}:assina-doc`);

  const [enviando, setEnviando] = useState<string | null>(null);
  const [meusAnexos, setMeusAnexos] = useState<AnexoPendente[]>([]);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [checklistAtivo, setChecklistAtivo] = useState<string | null>(null);

  const ordem = ordens.find((o) => o.id === id);
  const rotulos = useMemo(() => new Map(situacoes.map((s) => [s.key, s.label])), [situacoes]);
  const possiveis = useMemo(
    () => (ordem ? transicoes.filter((t) => t.from_key === ordem.status_key) : []),
    [transicoes, ordem]
  );

  /* Os anexos desta OS — do aparelho, e não da rede. */
  useEffect(() => {
    let vivo = true;
    void anexos.todos().then((todos) => {
      if (vivo) setMeusAnexos(todos.filter((a) => a.workOrderId === id));
    });
    return () => {
      vivo = false;
    };
  }, [anexos, id, estado.pendentes, estado.atencao]);

  /*
   * O CHECKLIST EM ANDAMENTO É LEMBRADO NO APARELHO.
   *
   * Sem isso, reabrir o aplicativo no meio de um checklist mostraria a lista de
   * modelos de novo — e a pessoa anexaria um segundo checklist à mesma OS,
   * achando que o primeiro se perdeu.
   */
  useEffect(() => {
    let vivo = true;
    const rascunhos = base.colecao<{ valor: string }>('rascunhos');
    void rascunhos.ler(`os:${id}:checklist`).then((r) => {
      if (vivo && r?.valor) setChecklistAtivo(r.valor);
    });
    void rascunhos.ler(`os:${id}:respostas`).then((r) => {
      if (vivo && r?.valor) setRespostas(JSON.parse(r.valor) as Record<string, string>);
    });
    return () => {
      vivo = false;
    };
  }, [base, id]);

  if (carregando) {
    return (
      <p className="mx-auto max-w-md text-sm text-muted" role="status">
        Lendo o aparelho…
      </p>
    );
  }

  if (!ordem) {
    /*
     * NÃO ESTÁ NO APARELHO — e a tela diz isso, e não "não encontrada".
     *
     * A diferença é tudo: "não encontrada" faz o técnico achar que a OS foi
     * apagada. O que aconteceu, quase sempre, é que ela não estava no escopo
     * quando ele sincronizou.
     */
    return (
      <div className="mx-auto max-w-md rounded-panel border border-border-subtle bg-surface p-4">
        <h1 className="text-base font-semibold text-text">Esta ordem não está no aparelho</h1>
        <p className="mt-1 text-sm text-muted">
          Ela pode ter sido atribuída depois da última sincronização, ou não pertencer ao seu escopo.
          Sincronize quando tiver rede.
        </p>
      </div>
    );
  }

  const ordemAtual = ordem;
  const agregado = `work_order:${ordemAtual.id}`;
  const modeloAtivo = modelos.find((m) => m.id === checklistAtivo?.split('|')[0]);
  const respostaId = checklistAtivo?.split('|')[1];

  async function comAviso<T>(marca: string, fn: () => Promise<T>): Promise<T | undefined> {
    setEnviando(marca);
    try {
      return await fn();
    } finally {
      setEnviando(null);
    }
  }

  async function iniciarCronometro() {
    await comAviso('cronometro', () =>
      enfileirar({
        agregado,
        metodo: 'POST',
        caminho: `/work-orders/${ordemAtual.id}/timer/start`,
        corpo: {},
        rotulo: `Iniciar cronômetro — ${ordemAtual.number ?? ordemAtual.title}`,
      })
    );
  }

  async function anexarChecklist(modelo: ModeloDeChecklist) {
    /*
     * O IDENTIFICADOR DA RESPOSTA NASCE AQUI, no aparelho.
     *
     * Responder um item exige esse identificador. Se ele viesse só do servidor,
     * o técnico teria de estar online para anexar antes de poder responder — e
     * anexar é a primeira coisa que ele faz ao chegar no equipamento.
     */
    const idDaResposta = crypto.randomUUID();
    await comAviso('checklist', async () => {
      await enfileirar({
        agregado,
        metodo: 'POST',
        caminho: `/work-orders/${ordemAtual.id}/checklists`,
        corpo: { template_id: modelo.id, response_id: idDaResposta },
        rotulo: `Checklist ${modelo.title}`,
      });
      const marca = `${modelo.id}|${idDaResposta}`;
      setChecklistAtivo(marca);
      await base.colecao<{ valor: string }>('rascunhos').gravar(`os:${id}:checklist`, { valor: marca });
    });
  }

  async function responder(item: ItemDeChecklist, valor: string) {
    if (!respostaId) return;

    const proximas = { ...respostas, [item.id]: valor };
    setRespostas(proximas);
    await base
      .colecao<{ valor: string }>('rascunhos')
      .gravar(`os:${id}:respostas`, { valor: JSON.stringify(proximas) });

    /*
     * O VEREDITO É DO SERVIDOR, e o cliente manda só o valor medido.
     *
     * Enviar `verdict` permitiria marcar como aprovado um número fora da faixa
     * — exatamente o que o motor de checklist existe para impedir.
     */
    const corpo: Record<string, unknown> = { item_id: item.id };
    if (item.kind === 'boolean') corpo.boolean = valor === 'sim';
    else if (item.kind === 'number') corpo.number = Number(valor);
    else if (item.kind === 'option') corpo.options = [valor];
    else corpo.text = valor;

    await enfileirar({
      agregado,
      metodo: 'POST',
      caminho: `/checklist-responses/${respostaId}/answers`,
      corpo,
      rotulo: `Resposta: ${item.label}`,
    });
  }

  async function consumirPeca(saldo: SaldoLocal, qtd: number) {
    await comAviso(`peca:${saldo.item_id}`, () =>
      enfileirar({
        agregado,
        metodo: 'POST',
        caminho: `/inventory/work-orders/${ordemAtual.id}/parts`,
        corpo: { item_id: saldo.item_id, warehouse_id: saldo.warehouse_id, qty: qtd },
        rotulo: `${qtd} ${saldo.unit} de ${saldo.name}`,
      })
    );
  }

  async function mudarSituacao(para: string) {
    await comAviso(para, async () => {
      await enfileirar({
        agregado,
        metodo: 'POST',
        caminho: `/work-orders/${ordemAtual.id}/transitions`,
        corpo: {
          to: para,
          ...(resolucao.trim() ? { resolution: resolucao.trim() } : {}),
        },
        rotulo: `${rotulos.get(para) ?? para} — ${ordemAtual.number ?? ordemAtual.title}`,
      });

      /*
       * OS RASCUNHOS SÓ SAEM DEPOIS DE VIRAREM COMANDO.
       *
       * Apagá-los antes de enfileirar abriria a janela em que o texto não está
       * em lugar nenhum — e é justamente o texto que a pessoa levou duas horas
       * para escrever.
       */
      await limparRascunhos(base, [`os:${id}:resolucao`]);
      setResolucao('');
    });
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      <header>
        <p className="text-xs font-medium text-subtle">{ordemAtual.number ?? 'sem número'}</p>
        <h1 className="text-lg font-semibold text-text">{ordemAtual.title}</h1>
        <p className="mt-0.5 text-xs text-muted">
          {ordemAtual.status_label}
          {ordemAtual.asset_name_snapshot ? ` · ${ordemAtual.asset_name_snapshot}` : ''}
          {ordemAtual.location_name_snapshot ? ` · ${ordemAtual.location_name_snapshot}` : ''}
        </p>
      </header>

      {ordemAtual.description && (
        <p className="rounded-panel border border-border-subtle bg-surface p-3 text-sm text-text">
          {ordemAtual.description}
        </p>
      )}

      {/* ------------------------------------------------------- cronômetro */}
      <section aria-labelledby="tempo" className="flex flex-col gap-2">
        <h2 id="tempo" className="text-sm font-semibold text-text">
          Tempo
        </h2>
        <button
          type="button"
          onClick={() => void iniciarCronometro()}
          disabled={enviando !== null}
          className="flex min-h-12 items-center justify-center gap-2 rounded-control border border-border-subtle bg-surface px-3 text-sm font-medium text-text"
        >
          <Timer aria-hidden className="size-4" />
          Iniciar cronômetro
        </button>
      </section>

      {/* -------------------------------------------------------- checklist */}
      <section aria-labelledby="checklist" className="flex flex-col gap-2">
        <h2 id="checklist" className="text-sm font-semibold text-text">
          Checklist
        </h2>

        {!modeloAtivo ? (
          modelos.length === 0 ? (
            <p className="text-sm text-muted">
              Nenhum roteiro publicado veio no pacote de hoje. Se este equipamento deveria ter um, sincronize
              quando tiver rede.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {modelos.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => void anexarChecklist(m)}
                  disabled={enviando !== null}
                  className="min-h-12 rounded-control border border-border-subtle bg-surface px-3 py-2 text-left text-sm font-medium text-text"
                >
                  {m.title}
                  <span className="block text-xs font-normal text-subtle">
                    {m.items.length} {m.items.length === 1 ? 'item' : 'itens'}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
          <ul className="flex flex-col gap-3">
            {[...modeloAtivo.items]
              .sort((a, b) => a.position - b.position)
              .map((item) => (
                <li key={item.id} className="rounded-panel border border-border-subtle bg-surface p-3">
                  <p className="text-sm font-medium text-text">
                    {item.label}
                    {item.required && <span className="text-danger"> *</span>}
                  </p>
                  {item.unit && <p className="text-xs text-subtle">em {item.unit}</p>}

                  {item.kind === 'boolean' ? (
                    <div className="mt-2 flex gap-2">
                      {(['sim', 'não'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => void responder(item, v)}
                          aria-pressed={respostas[item.id] === v}
                          className={`min-h-12 flex-1 rounded-control border px-3 text-sm font-medium ${
                            respostas[item.id] === v
                              ? 'border-accent bg-accent text-on-accent'
                              : 'border-border-subtle text-text'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  ) : item.kind === 'option' && item.options ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.options.map((o) => (
                        <button
                          key={o}
                          type="button"
                          onClick={() => void responder(item, o)}
                          aria-pressed={respostas[item.id] === o}
                          className={`min-h-12 rounded-control border px-3 text-sm ${
                            respostas[item.id] === o
                              ? 'border-accent bg-accent text-on-accent'
                              : 'border-border-subtle text-text'
                          }`}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      aria-label={item.label}
                      inputMode={item.kind === 'number' ? 'decimal' : 'text'}
                      defaultValue={respostas[item.id] ?? ''}
                      onBlur={(e) => void responder(item, e.target.value)}
                      className="mt-2 min-h-12 w-full rounded-control border border-border-subtle px-3 text-sm text-text"
                    />
                  )}

                  {respostas[item.id] !== undefined && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                      <CircleCheck aria-hidden className="size-3.5" />
                      {/*
                        "resposta guardada", e não "guardado no aparelho".

                        A dica do campo de diagnóstico logo abaixo diz "guardado
                        no aparelho enquanto você escreve" — e as duas frases
                        eram parecidas o bastante para se confundirem. Elas
                        falam de coisas diferentes: esta é UMA RESPOSTA que já
                        virou comando na fila; a outra é um texto que ainda está
                        sendo escrito e não virou nada.
                      */}
                      resposta guardada
                    </p>
                  )}
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------ fotos */}
      <section aria-labelledby="fotos" className="flex flex-col gap-2">
        <h2 id="fotos" className="text-sm font-semibold text-text">
          Fotos
        </h2>
        <div className="flex gap-2">
          {(
            [
              ['before', 'Antes'],
              ['after', 'Depois'],
            ] as const
          ).map(([finalidade, rotulo]) => (
            <button
              key={finalidade}
              type="button"
              onClick={() => void comAviso(`foto:${finalidade}`, () => capturarFoto(id, finalidade))}
              disabled={enviando !== null}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border border-border-subtle bg-surface px-3 text-sm font-medium text-text"
            >
              <Camera aria-hidden className="size-4" />
              {rotulo}
            </button>
          ))}
        </div>

        {meusAnexos.length > 0 && (
          <ul className="flex flex-col gap-1">
            {meusAnexos.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-control border border-border-subtle px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-text">{a.nomeDoArquivo}</span>
                {/*
                  O ESTADO DE CADA FOTO FICA VISÍVEL, e é o que separa "está no
                  aparelho" de "chegou ao servidor". Um visto único para as duas
                  coisas faria o técnico ir embora achando que enviou.
                */}
                <span className={`shrink-0 text-xs ${a.estado === 'falhou' ? 'text-danger' : 'text-muted'}`}>
                  {a.estado === 'enviado'
                    ? 'enviada'
                    : a.estado === 'falhou'
                      ? 'falhou'
                      : a.estado === 'enviando'
                        ? `${Math.round((a.enviados / Math.max(1, a.bytes)) * 100)}%`
                        : 'no aparelho'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------ peças */}
      <section aria-labelledby="pecas" className="flex flex-col gap-2">
        <h2 id="pecas" className="text-sm font-semibold text-text">
          Peças usadas
        </h2>
        {estoque.length === 0 ? (
          <p className="text-sm text-muted">
            Nenhum saldo veio no pacote de hoje. Sem ele não dá para apontar consumo aqui.
          </p>
        ) : (
          <>
            {/*
              O SALDO É INDICATIVO, e a tela diz isso.

              Ele foi baixado de manhã; às 11h outra pessoa pode ter levado a
              peça. Prometer o número faria o técnico contar com uma peça que não
              existe — e a recusa chegaria horas depois, no estacionamento.
            */}
            <p className="text-xs text-subtle">
              Saldo do último pacote — a confirmação é do servidor, no envio.
            </p>
            <ul className="flex flex-col gap-2">
              {estoque.slice(0, 20).map((s) => (
                <li
                  key={`${s.item_id}@${s.warehouse_id}`}
                  className="flex items-center gap-2 rounded-control border border-border-subtle bg-surface px-3 py-2"
                >
                  <Package aria-hidden className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{s.name}</span>
                    <span className="block text-xs text-subtle">
                      {s.on_hand} {s.unit} · {s.warehouse_name}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void consumirPeca(s, 1)}
                    disabled={enviando !== null}
                    aria-label={`Usei uma unidade de ${s.name}`}
                    className="min-h-11 shrink-0 rounded-control border border-border-subtle px-3 text-sm font-medium text-text"
                  >
                    usei 1
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ------------------------------------------------- diagnóstico e fim */}
      <section aria-labelledby="laudo" className="flex flex-col gap-3">
        <h2 id="laudo" className="text-sm font-semibold text-text">
          Diagnóstico e resolução
        </h2>

        <div className="flex flex-col gap-1">
          <label htmlFor="campo-diagnostico" className="text-xs text-subtle">
            O que estava acontecendo
          </label>
          <textarea
            id="campo-diagnostico"
            value={diagnostico}
            onChange={(e) => setDiagnostico(e.target.value)}
            rows={3}
            className="rounded-control border border-border-subtle bg-surface p-2 text-sm text-text"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="campo-resolucao" className="text-xs text-subtle">
            O que foi feito
          </label>
          <textarea
            id="campo-resolucao"
            value={resolucao}
            onChange={(e) => setResolucao(e.target.value)}
            rows={3}
            className="rounded-control border border-border-subtle bg-surface p-2 text-sm text-text"
          />
          {/*
            A PROMESSA PRECISA SER DITA, porque ela não é óbvia.

            Quem já perdeu um formulário digitando não confia em campo de texto
            de aplicativo — e vai preferir anotar no papel, que é justamente o
            comportamento que este produto existe para substituir.
          */}
          <p className="text-xs text-subtle">
            Guardado no aparelho enquanto você escreve. Fechar o aplicativo não perde.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------- assinatura */}
      <section aria-labelledby="assinatura" className="flex flex-col gap-2">
        <h2 id="assinatura" className="text-sm font-semibold text-text">
          Assinatura
        </h2>
        <Assinatura
          nome={nomeAssina}
          documento={docAssina}
          aoMudarNome={setNomeAssina}
          aoMudarDocumento={setDocAssina}
          desabilitado={enviando !== null}
          aoColher={(a) => {
            void comAviso('assinatura', async () => {
              /*
               * A ASSINATURA É UM ANEXO E UM COMANDO, nessa ordem.
               *
               * A imagem sobe pelo mesmo caminho retomável das fotos; o registro
               * da assinatura entra na fila logo depois, e o sequenciamento por
               * agregado garante que ele chegue ao servidor depois do anexo —
               * que é a ordem que o servidor espera.
               */
              const anexo = await anexarBytes(id, 'signature', a.bytes, 'image/png');
              await enfileirar({
                agregado,
                metodo: 'POST',
                caminho: `/work-orders/${id}/signatures`,
                corpo: {
                  signer_role: 'customer',
                  signer_name: a.nome,
                  method: 'drawn',
                  signer_document: a.documento,
                  /*
                   * A REFERÊNCIA, e não o identificador local.
                   *
                   * Offline o servidor ainda não registrou a imagem, e portanto
                   * ainda não existe identificador nenhum para pôr aqui. A fila
                   * troca isto pelo valor de verdade antes de enviar.
                   */
                  attachment_id: anexo ? referenciaAoAnexo(anexo.id) : null,
                },
                rotulo: `Assinatura de ${a.nome}`,
              });
              await limparRascunhos(base, [`os:${id}:assina-nome`, `os:${id}:assina-doc`]);
              setNomeAssina('');
              setDocAssina('');
            });
          }}
        />
      </section>

      {/* ---------------------------------------------------------- concluir */}
      <section aria-labelledby="acoes" className="flex flex-col gap-2">
        <h2 id="acoes" className="text-sm font-semibold text-text">
          Mudar a situação
        </h2>

        {possiveis.length === 0 ? (
          /*
           * SEM TRANSIÇÃO POSSÍVEL, a tela explica em vez de ficar vazia. Uma OS
           * fechada não vai a lugar nenhum, e uma área em branco aqui faria o
           * técnico achar que o aplicativo quebrou.
           */
          <p className="text-sm text-muted">
            Não há mudança de situação possível a partir de &ldquo;{ordemAtual.status_label}&rdquo; com o que
            está no aparelho.
          </p>
        ) : (
          possiveis.map((t) => (
            <button
              key={t.to_key}
              type="button"
              onClick={() => void mudarSituacao(t.to_key)}
              disabled={enviando !== null}
              className="min-h-12 rounded-control border border-border-subtle bg-surface px-3 text-sm font-medium text-text"
            >
              {rotulos.get(t.to_key) ?? t.to_key}
            </button>
          ))
        )}
      </section>

      {(estado.pendentes > 0 || estado.bloqueados > 0) && (
        <p className="rounded-control bg-surface-sunken p-2 text-xs text-muted" role="status">
          {/*
            O QUE ESTÁ NO APARELHO E AINDA NÃO CHEGOU — dito aqui também, e não
            só no topo. É nesta tela que a pessoa acabou de tocar o botão, e é
            aqui que ela precisa entender que "salvo" ainda não é "enviado".
          */}
          {estado.pendentes + estado.bloqueados === 1
            ? '1 ação guardada no aparelho, esperando rede.'
            : `${estado.pendentes + estado.bloqueados} ações guardadas no aparelho, esperando rede.`}
          {estado.bloqueados > 0 && ' Algumas estão paradas esperando a sua decisão em "Atenção".'}
        </p>
      )}
    </div>
  );
}
