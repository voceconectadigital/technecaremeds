/**
 * Aurora — a logo do cliente na tela (SPEC v0.2 §34).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE UM COMPONENTE, E NÃO UM `<img>` EM CADA TELA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Três coisas precisam ser decididas uma vez só, e todas as três já deram
 * errado em algum produto:
 *
 *  1. O TAMANHO MÁXIMO. O arquivo tem 272×73. Exibi-lo maior que isso o
 *     estica, e um logotipo esticado é a primeira coisa que um cliente nota —
 *     antes de qualquer tela. O componente limita, e quem pedir mais recebe o
 *     teto.
 *
 *  2. O FUNDO ESCURO. A logo foi desenhada para papel branco: o símbolo é
 *     grafite e a assinatura "ENGENHARIA CLÍNICA" é cinza. Sobre o tema
 *     escuro, os dois SOMEM — sobra "TéchneCare" flutuando, sem o símbolo que
 *     é metade da marca.
 *
 *     A saída NÃO é filtrar a imagem: inverter ou clarear uma logo altera as
 *     cores da marca, e as cores da marca não são nossas para alterar. A saída
 *     é a que todo manual de identidade prescreve — aplicá-la sobre uma ÁREA
 *     CLARA de respiro. É o que o tema escuro faz aqui.
 *
 *  3. O TEXTO ALTERNATIVO. É o nome do produto, vindo da configuração de
 *     marca, e não a palavra "logo" — quem usa leitor de tela quer saber de
 *     quem é o sistema, não que ali existe uma imagem.
 */
import { cn } from '../lib/cn';

export interface LogoProps {
  /** Endereço do arquivo. Vem da configuração de marca, nunca fixo na tela. */
  src: string;
  /** Nome do produto. Vira o texto alternativo. */
  nome: string;
  /** Largura em pixels. É limitada ao tamanho real do arquivo. */
  largura?: number;
  className?: string;
}

/**
 * A largura real do arquivo horizontal.
 *
 * Passar disso não melhora nada: o navegador interpola pixels que não existem.
 * Fica como constante nomeada porque, no dia em que chegar o vetor, é esta
 * linha que some — e a busca por ela encontra o comentário.
 */
const LARGURA_NATIVA = 272;
const PROPORCAO = 73 / 272;

export function Logo({ src, nome, largura = 180, className }: LogoProps) {
  const w = Math.min(largura, LARGURA_NATIVA);
  return (
    <span className={cn('aurora-logo inline-flex shrink-0 items-center', className)}>
      <img
        src={src}
        alt={nome}
        width={w}
        /* As duas dimensões declaradas: sem elas, a página salta quando a
           imagem chega, e o salto acontece justamente no login, onde a pessoa
           já está com o cursor no campo. */
        height={Math.round(w * PROPORCAO)}
        style={{ width: w, height: 'auto' }}
        className="block max-w-full select-none"
      />
    </span>
  );
}
