/**
 * Téchne Care — em que ambiente esta interface está rodando.
 *
 * Há DOIS, e a escolha é feita NA COMPILAÇÃO, nunca em tempo de execução:
 *
 *   conectado      → os dados vêm da API (`ApiDataProvider`). É o produto.
 *   demonstração   → os dados vêm de respostas gravadas no pacote
 *                    (`DemoDataProvider`). Nenhuma chamada de rede acontece.
 *
 * `VITE_DEMO_MODE` é lida pelo `vite.config.ts` e vira a constante literal
 * `__MODO_DEMO__` no momento do build. Não existe parâmetro de URL, chave de `localStorage` nem cabeçalho que
 * mude o ambiente de uma interface já publicada — e por isso a demonstração não
 * pode ser ligada por acidente na frente de um cliente de verdade, nem o
 * contrário. O `vite.config.ts` ainda recusa o build que peça os dois ao mesmo
 * tempo (demonstração com `VITE_API_URL`).
 *
 * Este é o ÚNICO lugar que lê a variável. As telas não perguntam em que
 * ambiente estão: quem precisa saber (a moldura, a entrada) lê `useAmbiente`.
 */
import { createContext, useContext } from 'react';
import { MARCA } from '@aurora/app-kit';

declare const __MODO_DEMO__: boolean | undefined;

/*
 * `typeof` protege quem roda o código fora do Vite — os testes de interface —,
 * onde a constante não foi definida: ali o ambiente é sempre o conectado.
 */
export const MODO_DEMO: boolean = typeof __MODO_DEMO__ !== 'undefined' && __MODO_DEMO__ === true;

export interface Ambiente {
  /** Dados fictícios e nada persiste — a moldura avisa. */
  demonstracao: boolean;
  /** O nome no título da aba do navegador. */
  tituloProduto: string;
}

/*
 * O padrão é o produto conectado: um componente renderizado fora do provedor —
 * um teste, por exemplo — nunca se apresenta como demonstração por omissão.
 */
export const AmbienteCtx = createContext<Ambiente>({
  demonstracao: false,
  tituloProduto: MARCA.produto,
});

export function useAmbiente(): Ambiente {
  return useContext(AmbienteCtx);
}
