/**
 * Aurora — o botão "Imprimir" (conversa com o cliente, 21/10/2026).
 *
 * Usa a impressão do navegador: o papel sai do que está na tela, com a folha de estilo
 * de impressão de `styles.css` (a navegação e os botões somem, o conteúdo flui). Quem
 * quer PDF escolhe "Salvar como PDF" no diálogo do sistema — não há geração no servidor
 * para manter.
 */
import { Printer } from 'lucide-react';
import { Button } from '@aurora/ui';

export function BotaoImprimir({ rotulo = 'Imprimir' }: { rotulo?: string }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="aurora-no-print"
      icon={<Printer className="size-4" aria-hidden="true" />}
      onClick={() => window.print()}
    >
      {rotulo}
    </Button>
  );
}
