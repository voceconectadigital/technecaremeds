/**
 * Aurora — ponto de entrada da aplicação web.
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
