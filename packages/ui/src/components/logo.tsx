/**
 * Aurora — a logo do produto.
 *
 * DUAS VARIANTES, UMA NA TELA: a logo da marca tem um azul-marinho que some
 * sobre fundo escuro. Em vez de pôr uma placa branca atrás dela (o que parecia
 * adesivo colado no painel), a configuração de marca traz uma variante para o
 * tema escuro e o CSS mostra a certa conforme `data-theme` — sem esperar o
 * React, sem piscar.
 */
import { cn } from '../lib/cn';

export interface LogoProps {
  /** Endereço do arquivo. Vem da configuração de marca, nunca fixo na tela. */
  src: string;
  /** Variante para fundo escuro. Sem ela, vale `src` com a placa clara de antes. */
  srcEscuro?: string | null;
  /** Nome do produto. Vira o texto alternativo. */
  nome: string;
  /** Largura em pixels. É limitada ao tamanho real do arquivo. */
  largura?: number;
  className?: string;
}

const LARGURA_NATIVA = 385;
const PROPORCAO = 148 / 385;

export function Logo({ src, srcEscuro, nome, largura = 180, className }: LogoProps) {
  const w = Math.min(largura, LARGURA_NATIVA);
  const h = Math.round(w * PROPORCAO);
  const img = (endereco: string, classe: string, alt: string) => (
    <img
      src={endereco}
      alt={alt}
      width={w}
      /* As duas dimensões declaradas: sem elas, a página salta quando a
         imagem chega, e o salto acontece justamente no login, onde a pessoa
         já está com o cursor no campo. */
      height={h}
      style={{ width: w, height: 'auto' }}
      className={cn('block max-w-full select-none', classe)}
      draggable={false}
    />
  );
  return (
    <span
      className={cn(
        'aurora-logo inline-flex shrink-0 items-center',
        srcEscuro && 'aurora-logo--duplo',
        className
      )}
    >
      {img(src, 'aurora-logo-claro', nome)}
      {/* As duas têm o nome: a oculta (display:none) sai da árvore de acessibilidade. */}
      {srcEscuro && img(srcEscuro, 'aurora-logo-escuro', nome)}
    </span>
  );
}
