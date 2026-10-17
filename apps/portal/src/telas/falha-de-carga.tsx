/**
 * Portal — a consulta FALHOU, e a tela diz isso (pente-fino 17/10/2026).
 *
 * Antes, erro de carga caía no mesmo ramo do vazio: com a rede do hospital fora,
 * o cliente lia "Nada aguardando você" e "Nenhum chamado aberto" — uma
 * informação falsa e tranquilizadora. Falha não é ausência.
 */
import { CloudOff } from 'lucide-react';
import { Button, EmptyState } from '@aurora/ui';

export function FalhaDeCarga({ onTentar, className }: { onTentar: () => void; className?: string }) {
  return (
    <EmptyState
      icon={<CloudOff className="size-5" />}
      title="Não conseguimos carregar agora"
      description="Confira a conexão e tente de novo. Nada do que você enviou se perdeu."
      action={
        <Button variant="secondary" size="sm" onClick={onTentar}>
          Tentar de novo
        </Button>
      }
      className={className}
    />
  );
}
