/**
 * Aurora — assinatura no dedo (SPEC v0.2 §20 · EPIC-014).
 *
 * A SPEC pede "coleta no dedo, com nome e documento do signatário". Isso é um
 * `canvas` e três campos — e algumas decisões que só aparecem quando alguém
 * tenta assinar de verdade, em pé, num corredor.
 *
 * PONTEIRO, E NÃO TOQUE.
 *
 * `pointerdown`/`pointermove` cobrem dedo, caneta e mouse com um código só. Os
 * eventos de toque exigiriam um segundo caminho para quem testa no computador —
 * e o segundo caminho é sempre o que fica para trás.
 *
 * O CANVAS TEM RESOLUÇÃO DE APARELHO.
 *
 * Um `canvas` de 300 pixels CSS num aparelho com três vezes a densidade tem 300
 * pixels de verdade, e a assinatura sai serrilhada — num documento que vai para
 * o cliente. Multiplicar pela densidade e escalar o contexto resolve, e é a
 * única forma de o traço parecer traço.
 *
 * O TRAÇO É DA PESSOA, E A IMAGEM É EVIDÊNCIA.
 *
 * Nada de suavização automática nem de "embelezar" o traço: uma assinatura
 * alterada pelo aplicativo perde valor num documento assinado, e é o tipo de
 * conveniência que ninguém percebe até um contrato ser questionado.
 */
import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

export interface AssinaturaColhida {
  /** PNG, para virar anexo. */
  bytes: Uint8Array;
  nome: string;
  documento: string | null;
}

export function Assinatura({
  nome,
  documento,
  aoMudarNome,
  aoMudarDocumento,
  aoColher,
  desabilitado,
}: {
  nome: string;
  documento: string;
  aoMudarNome(v: string): void;
  aoMudarDocumento(v: string): void;
  aoColher(a: AssinaturaColhida): void;
  desabilitado?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const desenhando = useRef(false);
  const [temTraco, setTemTraco] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const densidade = window.devicePixelRatio || 1;
    const caixa = canvas.getBoundingClientRect();
    canvas.width = Math.round(caixa.width * densidade);
    canvas.height = Math.round(caixa.height * densidade);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(densidade, densidade);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    /*
     * PRETO LITERAL, e não a cor do tema.
     *
     * A imagem vai para um PDF e para o cliente, fora do aplicativo — onde o
     * tema escuro não existe. Uma assinatura na cor do texto do tema sairia
     * branca sobre branco no documento.
     */
    ctx.strokeStyle = '#111111';
  }, []);

  function posicao(e: React.PointerEvent<HTMLCanvasElement>) {
    const caixa = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - caixa.left, y: e.clientY - caixa.top };
  }

  function comecar(e: React.PointerEvent<HTMLCanvasElement>) {
    if (desabilitado) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    /*
     * A CAPTURA DO PONTEIRO É UM BÔNUS, e não pode derrubar o traço.
     *
     * Ela faz o dedo que sai da borda do quadro continuar desenhando, em vez de
     * o traço parar no meio da letra. Mas `setPointerCapture` LANÇA quando o
     * ponteiro não está mais ativo — e, se a exceção subir aqui, ela aborta o
     * manipulador antes de `desenhando` virar verdadeiro: o quadro fica inerte,
     * o botão de guardar nunca habilita, e a pessoa conclui que a tela travou.
     *
     * Foi exatamente assim que apareceu: a assinatura não registrava traço
     * nenhum, sem erro visível.
     */
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* sem captura: o traço para na borda, e ainda assim é um traço */
    }
    desenhando.current = true;
    const { x, y } = posicao(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = posicao(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!temTraco) setTemTraco(true);
  }

  function terminar() {
    desenhando.current = false;
  }

  function limpar() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setTemTraco(false);
  }

  async function colher() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return;
    aoColher({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      nome: nome.trim(),
      documento: documento.trim() || null,
    });
    limpar();
  }

  const podeColher = temTraco && nome.trim().length >= 2 && !desabilitado;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="assina-nome" className="text-xs text-subtle">
          Quem está assinando
        </label>
        <input
          id="assina-nome"
          value={nome}
          onChange={(e) => aoMudarNome(e.target.value)}
          autoCapitalize="words"
          className="min-h-12 rounded-control border border-border-subtle bg-surface px-3 text-sm text-text"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="assina-doc" className="text-xs text-subtle">
          Documento (opcional)
        </label>
        <input
          id="assina-doc"
          value={documento}
          onChange={(e) => aoMudarDocumento(e.target.value)}
          inputMode="numeric"
          className="min-h-12 rounded-control border border-border-subtle bg-surface px-3 text-sm text-text"
        />
      </div>

      {/*
        `touch-none` é obrigatório, e a ausência dele é o defeito clássico deste
        componente: sem ele, arrastar o dedo no quadro ROLA A PÁGINA em vez de
        desenhar, e a assinatura sai como um risco solto no meio da tela.
      */}
      <canvas
        ref={canvasRef}
        onPointerDown={comecar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        aria-label="Área de assinatura"
        role="img"
        className="h-40 w-full touch-none rounded-panel border border-dashed border-border-strong bg-white"
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={limpar}
          disabled={!temTraco}
          className="flex min-h-12 items-center gap-1.5 rounded-control border border-border-subtle px-3 text-sm text-muted"
        >
          <Eraser aria-hidden className="size-4" />
          Limpar
        </button>
        <button
          type="button"
          onClick={() => void colher()}
          disabled={!podeColher}
          className="min-h-12 flex-1 rounded-control bg-accent px-3 text-sm font-semibold text-on-accent disabled:opacity-50"
        >
          Guardar assinatura
        </button>
      </div>

      {!podeColher && (
        /*
         * O BOTÃO DESABILITADO PRECISA DIZER O QUE FALTA.
         *
         * Um botão apagado sem explicação faz a pessoa tocar três vezes e
         * concluir que o aplicativo travou — em pé, no corredor, com o cliente
         * esperando.
         */
        <p className="text-xs text-subtle">
          {nome.trim().length < 2
            ? 'Escreva o nome de quem está assinando.'
            : 'Assine no quadro acima com o dedo.'}
        </p>
      )}
    </div>
  );
}
