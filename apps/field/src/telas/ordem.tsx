/**
 * Aurora — executar a ordem, com ou sem rede (SPEC v0.2 §20 · EPIC-014).
 *
 * TODO BOTÃO DESTA TELA ENFILEIRA. Nenhum espera resposta do servidor.
 *
 * É a diferença entre um aplicativo de campo e um site que abre no celular. Um
 * botão que espera resposta trava a tela no subsolo, e o técnico fica olhando
 * um giro por trinta segundos até desistir — e o que ele fez naquele momento
 * não existe em lugar nenhum.
 *
 * Aqui o toque grava LOCALMENTE e volta na hora. A tela mostra o estado como
 * ele ficou, e o indicador do topo diz quantas coisas ainda não chegaram ao
 * servidor. A pessoa continua trabalhando.
 *
 * O GRAFO DECIDE OS BOTÕES, e o grafo veio no pacote do dia.
 *
 * Sem ele só restaria oferecer todos e deixar o servidor recusar — e a recusa
 * chegaria horas depois, no estacionamento, virando conflito. Com ele, "não dá
 * para concluir sem iniciar" aparece enquanto a pessoa ainda está na frente do
 * equipamento.
 */
import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useCampo, useColecaoLocal } from '../campo';

interface OrdemLocal {
  id: string;
  number: string | null;
  title: string;
  description: string | null;
  status_key: string;
  status_label: string;
  category: string;
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

export function OrdemPage() {
  /*
   * `strict: false`, e o motivo está escrito porque a alternativa parece melhor
   * e não é.
   *
   * `from: '/ordens/$id'` é o CAMINHO, e o que `useParams` quer é o ID DA
   * ROTA. Sob a rota-casca sem caminho próprio, os dois deixam de coincidir —
   * e o erro não aparece como aviso de tipo: aparece como a tela inteira
   * caindo no limite de erro do roteador, com "Something went wrong!" no lugar
   * da ordem de serviço. Foi assim que apareceu aqui.
   *
   * Amarrar o `from` ao identificador correto funcionaria hoje e quebraria de
   * novo na próxima vez que a árvore de rotas mudasse — com o mesmo sintoma
   * ilegível. A conversão de tipo fica nesta linha, com o motivo, em vez de o
   * aplicativo carregar uma armadilha.
   */
  const { id } = useParams({ strict: false }) as { id: string };
  const { enfileirar, estado } = useCampo();

  const { linhas: ordens, carregando } = useColecaoLocal<OrdemLocal>('ordens');
  const { linhas: transicoes } = useColecaoLocal<TransicaoLocal>('transicoes');
  const { linhas: situacoes } = useColecaoLocal<SituacaoLocal>('situacoes');

  const [resolucao, setResolucao] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);

  const ordem = ordens.find((o) => o.id === id);

  const rotulos = useMemo(() => new Map(situacoes.map((s) => [s.key, s.label])), [situacoes]);

  const possiveis = useMemo(
    () => (ordem ? transicoes.filter((t) => t.from_key === ordem.status_key) : []),
    [transicoes, ordem]
  );

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

  async function transicionar(para: string) {
    if (!ordem) return;
    setEnviando(para);
    try {
      await enfileirar({
        // O agregado é a OS: é ele que sequencia os comandos e é ele que
        // trava quando um deles conflita.
        agregado: `work_order:${ordem.id}`,
        metodo: 'POST',
        caminho: `/work-orders/${ordem.id}/transitions`,
        corpo: { to: para, ...(resolucao.trim() ? { resolution: resolucao.trim() } : {}) },
        rotulo: `${rotulos.get(para) ?? para} — ${ordem.number ?? ordem.title}`,
      });
    } finally {
      setEnviando(null);
    }
  }

  async function iniciarCronometro() {
    if (!ordem) return;
    setEnviando('cronometro');
    try {
      await enfileirar({
        agregado: `work_order:${ordem.id}`,
        metodo: 'POST',
        caminho: `/work-orders/${ordem.id}/timer/start`,
        corpo: {},
        rotulo: `Iniciar cronômetro — ${ordem.number ?? ordem.title}`,
      });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <header>
        <p className="text-xs font-medium text-subtle">{ordem.number ?? 'sem número'}</p>
        <h1 className="text-lg font-semibold text-text">{ordem.title}</h1>
        <p className="mt-0.5 text-xs text-muted">
          {ordem.status_label}
          {ordem.asset_name_snapshot ? ` · ${ordem.asset_name_snapshot}` : ''}
          {ordem.location_name_snapshot ? ` · ${ordem.location_name_snapshot}` : ''}
        </p>
      </header>

      {ordem.description && (
        <p className="rounded-panel border border-border-subtle bg-surface p-3 text-sm text-text">
          {ordem.description}
        </p>
      )}

      <section aria-labelledby="acoes" className="flex flex-col gap-2">
        <h2 id="acoes" className="text-sm font-semibold text-text">
          O que fazer agora
        </h2>

        <button
          type="button"
          onClick={() => void iniciarCronometro()}
          disabled={enviando !== null}
          className="min-h-12 rounded-control border border-border-subtle bg-surface px-3 text-sm font-medium text-text"
        >
          Iniciar cronômetro
        </button>

        {possiveis.length === 0 ? (
          /*
           * SEM TRANSIÇÃO POSSÍVEL, e a tela explica em vez de ficar vazia.
           *
           * Acontece de verdade: uma OS fechada não vai a lugar nenhum. Uma
           * área em branco aqui faria o técnico achar que o aplicativo quebrou.
           */
          <p className="text-sm text-muted">
            Não há mudança de situação possível a partir de &ldquo;{ordem.status_label}&rdquo; com o que está
            no aparelho.
          </p>
        ) : (
          possiveis.map((t) => (
            <button
              key={t.to_key}
              type="button"
              onClick={() => void transicionar(t.to_key)}
              disabled={enviando !== null}
              className="min-h-12 rounded-control border border-border-subtle bg-surface px-3 text-sm font-medium text-text"
            >
              {rotulos.get(t.to_key) ?? t.to_key}
            </button>
          ))
        )}
      </section>

      {/*
        UM `div`, E NÃO UMA `section` COM `aria-labelledby`.
        
        A versão anterior apontava o rótulo do campo como nome da região — e o
        resultado era DOIS elementos com o mesmo nome acessível: a região e o
        próprio campo. Para quem usa leitor de tela, "O que foi feito" passava a
        anunciar duas coisas diferentes; para o teste, a busca por rótulo ficou
        ambígua, que foi como isto apareceu.
        
        Um campo só não é uma região. O rótulo pertence ao campo, e a ele
        apenas.
      */}
      <div className="flex flex-col gap-1">
        <label htmlFor="campo-resolucao" className="text-sm font-semibold text-text">
          O que foi feito
        </label>
        <p className="text-xs text-subtle">
          Vai junto com a mudança de situação. Escreva enquanto está na frente do equipamento — depois ninguém
          lembra.
        </p>
        <textarea
          id="campo-resolucao"
          value={resolucao}
          onChange={(e) => setResolucao(e.target.value)}
          rows={4}
          className="rounded-control border border-border-subtle bg-surface p-2 text-sm text-text"
        />
      </div>

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
