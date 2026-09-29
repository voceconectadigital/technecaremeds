/**
 * Aurora — a miniatura de um item físico (SPEC v0.2 §15, §34).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE UMA LISTA DE PEÇAS PRECISA DE IMAGEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não é enfeite. "Filtro HEPA FIL-HEPA-01" e "Filtro HEPA FIL-HEPA-02" são
 * duas linhas de texto quase idênticas, e a pessoa no almoxarifado está com a
 * peça na mão comparando com a tela. A imagem é o que transforma uma busca por
 * código numa conferência visual de um segundo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O FALLBACK É PARTE DO DESENHO, NÃO UM ACIDENTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A maior parte do acervo vai ficar sem foto por muito tempo — ninguém
 * fotografa 3 mil itens num sábado. Um ícone cinza genérico em 90% das linhas
 * faria a lista parecer quebrada, então o vazio aqui é DESENHADO: as iniciais
 * do item sobre um fundo derivado do próprio nome. Cores estáveis, distintas
 * entre vizinhos, e legíveis — o mesmo item tem sempre a mesma cor, o que dá
 * memória visual mesmo sem foto.
 */
import { useState } from 'react';
import { cn } from '../lib/cn';

export interface ThumbProps {
  /** Endereço da imagem. Vazio ou quebrado cai no desenho de iniciais. */
  src?: string | null;
  /** Nome do item — vira as iniciais, a cor e o texto alternativo. */
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** `square` para peça, `rounded` para pessoa ou marca. */
  shape?: 'square' | 'rounded';
  className?: string;
}

const TAMANHOS = {
  sm: 'size-10 text-xs',
  md: 'size-14 text-sm',
  lg: 'size-20 text-lg',
} as const;

/**
 * Seis pares (fundo, texto) com contraste conferido.
 *
 * Derivados da paleta de dados, e não do acaso: são os mesmos seis tons que os
 * gráficos usam, então a tela inteira continua tendo uma família de cores só.
 */
const PALETA = [
  { bg: 'color-mix(in oklab, var(--color-data-1) 14%, var(--color-surface))', fg: 'var(--color-data-1)' },
  { bg: 'color-mix(in oklab, var(--color-data-2) 14%, var(--color-surface))', fg: 'var(--color-data-2)' },
  { bg: 'color-mix(in oklab, var(--color-data-3) 16%, var(--color-surface))', fg: 'var(--color-data-3)' },
  { bg: 'color-mix(in oklab, var(--color-data-4) 14%, var(--color-surface))', fg: 'var(--color-data-4)' },
  { bg: 'color-mix(in oklab, var(--color-data-5) 14%, var(--color-surface))', fg: 'var(--color-data-5)' },
  { bg: 'color-mix(in oklab, var(--color-data-6) 14%, var(--color-surface))', fg: 'var(--color-data-6)' },
];

/**
 * Um número estável a partir do nome.
 *
 * Precisa ser ESTÁVEL: se a cor mudasse entre duas renderizações, a memória
 * visual que o fallback existe para criar não se formaria. É um `hash`
 * bobinho e determinístico, de propósito.
 */
function indiceDe(nome: string): number {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return h % PALETA.length;
}

function iniciaisDe(nome: string): string {
  const palavras = nome
    .trim()
    .split(/\s+/)
    // "de", "do", "da" não ajudam a distinguir "Bomba de infusão" de
    // "Bomba de vácuo" — as iniciais úteis são as das palavras cheias.
    .filter((p) => p.length > 2);
  if (palavras.length === 0) return nome.slice(0, 2).toUpperCase();
  if (palavras.length === 1) return palavras[0]!.slice(0, 2).toUpperCase();
  return (palavras[0]![0]! + palavras[1]![0]!).toUpperCase();
}

export function Thumb({ src, name, size = 'md', shape = 'square', className }: ThumbProps) {
  const [falhou, setFalhou] = useState(false);
  const mostrarImagem = Boolean(src) && !falhou;
  const cor = PALETA[indiceDe(name)]!;

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border border-border-subtle',
        shape === 'square' ? 'rounded-card' : 'rounded-pill',
        TAMANHOS[size],
        className
      )}
      style={mostrarImagem ? { backgroundColor: 'var(--color-surface-sunken)' } : { backgroundColor: cor.bg }}
    >
      {mostrarImagem ? (
        <img
          src={src!}
          alt={name}
          loading="lazy"
          // `contain` e não `cover`: uma peça fotografada em fundo branco
          // cortada nas bordas perde justamente o contorno, que é o que a
          // identifica. Para rosto, `cover` seria melhor — e rosto usa Avatar.
          className="size-full object-contain"
          onError={() => setFalhou(true)}
        />
      ) : (
        <span aria-hidden="true" className="font-semibold tracking-tight" style={{ color: cor.fg }}>
          {iniciaisDe(name)}
        </span>
      )}
    </span>
  );
}
