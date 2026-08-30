/**
 * Aurora — ponto de entrada do aplicativo de campo.
 *
 * O `service worker` é registrado AQUI, e depois do primeiro pintar.
 *
 * Registrá-lo antes disputaria a linha principal com a renderização — e a
 * primeira coisa que o técnico vê de manhã é esta tela. O casco só precisa
 * estar em cache na PRÓXIMA abertura, que é quando ele será usado sem rede.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('elemento #root não encontrado no documento');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>
);

/*
 * `import.meta.env.PROD`: em desenvolvimento o Vite serve módulos que mudam a
 * cada salvamento, e um `service worker` cacheando isso faria a tela mostrar a
 * versão de dez minutos atrás — o defeito mais confuso que existe, porque o
 * código na tela não é o código no arquivo.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /*
       * O REGISTRO FALHANDO NÃO PODE DERRUBAR O APLICATIVO.
       *
       * Sem `service worker` ele ainda funciona offline — a base local e a
       * fila são independentes dele. O que se perde é o casco em cache, ou
       * seja: ele deixa de ABRIR sem rede, mas continua guardando o trabalho
       * de quem já o abriu.
       */
    });
  });
}
