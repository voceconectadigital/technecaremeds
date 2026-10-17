/**
 * Aurora — ponto de entrada do portal do cliente.
 */
// PRIMEIRO: antes de qualquer contrato ser construído (ver sem-eval.ts).
import './sem-eval';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('elemento #root não encontrado no documento');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>
);
