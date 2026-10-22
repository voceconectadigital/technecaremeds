/**
 * Aurora — `/q/:token`: o destino do QR da etiqueta (conversa com o cliente, 21/10/2026).
 *
 * Ler a etiqueta com a câmera abre esta rota. Ela procura o equipamento pelo token, DENTRO
 * do escopo de quem lê, e leva à ficha. Etiqueta desconhecida — ou de um equipamento que esta
 * pessoa não enxerga — responde igual: "não encontramos", sem dizer qual dos dois foi.
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { QrCode } from 'lucide-react';
import { Button, EmptyState, SkeletonList } from '@aurora/ui';
import { assetsList } from '@aurora/contracts';
import { useApiQuery } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';

export function EtiquetaPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const navigate = useNavigate();
  const { data, isLoading, isError } = useApiQuery(assetsList, { query: { qr: token, limit: 1 } }) as {
    data: { items: { id: string }[] } | undefined;
    isLoading: boolean;
    isError: boolean;
  };

  const achado = data?.items[0]?.id;
  useEffect(() => {
    if (achado) void navigate({ to: '/ativos/$id', params: { id: achado }, replace: true });
  }, [achado, navigate]);

  return (
    <AppShell title="Etiqueta do equipamento" imprimir={false}>
      {isLoading || achado ? (
        <SkeletonList rows={2} label="equipamento" />
      ) : (
        <EmptyState
          icon={<QrCode className="size-5" />}
          title={isError ? 'Não conseguimos consultar agora' : 'Não encontramos este equipamento'}
          description={
            isError
              ? 'Confira a conexão e leia a etiqueta de novo.'
              : 'A etiqueta pode ser de outro cliente, ter sido trocada ou o equipamento não estar no seu acesso.'
          }
          action={
            <Button variant="secondary" size="sm" onClick={() => void navigate({ to: '/ativos' })}>
              Ver os equipamentos
            </Button>
          }
        />
      )}
    </AppShell>
  );
}
