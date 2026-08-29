/**
 * Aurora — a tela que ainda não existe, dizendo que ainda não existe.
 *
 * A alternativa seria esconder o item do menu até a tela ficar pronta. Isso
 * faria o produto parecer menor do que é — a API já atende todas estas áreas —
 * e faria o menu mudar de tamanho a cada semana, que é a forma mais rápida de
 * fazer alguém perder a referência de onde as coisas ficam.
 *
 * Uma tela honesta sobre o que falta é melhor do que um 404 e melhor do que um
 * menu instável.
 */
import { Construction } from 'lucide-react';
import { Card, EmptyState, StatusChip } from '@aurora/ui';
import { AppShell } from '../shell/app-shell';

export function EmConstrucao({
  titulo,
  descricao,
  permissao,
}: {
  titulo: string;
  descricao: string;
  /** A permissão que governa esta área, quando houver. */
  permissao?: string;
}) {
  return (
    <AppShell title={titulo}>
      <Card className="mx-auto max-w-xl">
        <EmptyState
          icon={<Construction className="size-5" />}
          title="Esta tela ainda não foi construída"
          description={descricao}
          action={
            <div className="flex flex-col items-center gap-3">
              <StatusChip tone="info">Interface em construção · API pronta</StatusChip>
              <p className="max-w-sm text-xs text-muted">
                As operações desta área já existem na API e estão cobertas por teste. O que falta é a tela.
                {permissao && (
                  <>
                    {' '}
                    A permissão que governa o acesso é <code className="font-mono">{permissao}</code>.
                  </>
                )}
              </p>
            </div>
          }
        />
      </Card>
    </AppShell>
  );
}
