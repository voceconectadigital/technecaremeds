/**
 * Aurora — logomarcas da organização (pedido do Anderson, 06/11/2026).
 *
 * "Até 2 logos por empresa": a do hospital e a da mantenedora, a da prestadora e a do hospital, a da
 * empresa e a do grupo. Duas vagas, na ordem em que saem no cabeçalho da folha de impressão da OS.
 *
 * Quem tem `organization.update` põe, troca e tira; os demais só veem. Esconder o botão é
 * conveniência — quem nega é o servidor.
 */
import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button, Card, Field, Input, SkeletonList, useToast } from '@aurora/ui';
import {
  ORGANIZATION_LOGO_MAX_BYTES,
  ORGANIZATION_LOGO_TYPES,
  organizationsLogoRemove,
  organizationsLogoSet,
  organizationsLogos,
  type OrganizationLogo,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { AlternadorDeConfiguracoes } from './alternador';

const VAGAS = [
  { slot: 1 as const, titulo: 'Logomarca principal', exemplo: 'Ex.: Hospital, prestadora ou empresa' },
  { slot: 2 as const, titulo: 'Segunda logomarca', exemplo: 'Ex.: Mantenedora, hospital ou grupo' },
];

/** Lê o arquivo como base64 puro (sem o prefixo `data:`). */
function emBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).replace(/^data:[^,]*,/, ''));
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

export function LogomarcasPage() {
  const { can } = usePermissions();
  const edita = can('organization.update');
  const { data, isLoading } = useApiQuery(organizationsLogos) as {
    data: { items: OrganizationLogo[] } | undefined;
    isLoading: boolean;
  };
  const logos = data?.items ?? [];

  return (
    <AppShell
      title="Logomarcas"
      subtitle="Até duas, impressas no cabeçalho da folha da OS. Sem nenhuma, a folha sai com o nome da organização."
      breadcrumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Logomarcas' }]}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AlternadorDeConfiguracoes />
      </div>
      {isLoading ? (
        <SkeletonList label="Carregando as logomarcas" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {VAGAS.map((v) => (
            <VagaDeLogo
              key={v.slot}
              {...v}
              atual={logos.find((l) => l.slot === v.slot) ?? null}
              edita={edita}
            />
          ))}
        </div>
      )}
      <p className="mt-4 text-sm text-muted">
        PNG, JPEG ou WebP, até 512 kB. Prefira fundo transparente e a versão horizontal da marca: a folha
        reduz a imagem para caber, sem distorcer.
      </p>
    </AppShell>
  );
}

function VagaDeLogo({
  slot,
  titulo,
  exemplo,
  atual,
  edita,
}: {
  slot: 1 | 2;
  titulo: string;
  exemplo: string;
  atual: OrganizationLogo | null;
  edita: boolean;
}) {
  const toast = useToast();
  const entrada = useRef<HTMLInputElement>(null);
  const [rotulo, setRotulo] = useState(atual?.label ?? '');
  const erro = (titulo: string) => (e: ApiError) => toast.error(titulo, e.problem.message);
  const por = useApiMutation(organizationsLogoSet, {
    invalidates: [organizationsLogos],
    onSuccess: () => toast.success('Logomarca salva', 'Já sai na próxima impressão de OS.'),
    onError: erro('Não foi possível salvar a logomarca'),
  });
  const tirar = useApiMutation(organizationsLogoRemove, {
    invalidates: [organizationsLogos],
    onSuccess: () => toast.success('Logomarca removida'),
    onError: erro('Não foi possível remover a logomarca'),
  });

  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return;
    if (!(ORGANIZATION_LOGO_TYPES as readonly string[]).includes(arquivo.type)) {
      toast.error('Formato não aceito', 'Use PNG, JPEG ou WebP.');
      return;
    }
    if (arquivo.size > ORGANIZATION_LOGO_MAX_BYTES) {
      toast.error('Arquivo grande demais', 'A logomarca pode ter até 512 kB.');
      return;
    }
    por.mutate({
      params: { slot: String(slot) },
      body: {
        file_name: arquivo.name,
        content_type: arquivo.type,
        data_base64: await emBase64(arquivo),
        label: rotulo.trim() || null,
      },
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4" as="section">
      <header>
        <h2 className="text-base font-semibold">
          {slot}. {titulo}
        </h2>
        <p className="text-sm text-muted">{exemplo}</p>
      </header>
      <div
        className="flex h-28 items-center justify-center rounded-control border border-dashed border-border bg-surface-subtle p-3"
        data-testid={`previa-logo-${slot}`}
      >
        {atual ? (
          <img
            src={atual.data_url}
            alt={atual.label ?? `Logomarca ${slot}`}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-sm text-muted">Nenhuma logomarca nesta vaga</span>
        )}
      </div>
      {atual && (
        <p className="truncate text-xs text-muted">
          {atual.file_name} · {Math.max(1, Math.round(atual.size / 1024))} kB
        </p>
      )}
      {edita && (
        <>
          <Field label="Nome da marca (texto alternativo)">
            <Input
              value={rotulo}
              maxLength={80}
              onChange={(e) => setRotulo(e.target.value)}
              placeholder={exemplo.replace('Ex.: ', '')}
            />
          </Field>
          <input
            ref={entrada}
            type="file"
            accept={ORGANIZATION_LOGO_TYPES.join(',')}
            className="sr-only"
            aria-label={`Arquivo da logomarca ${slot}`}
            onChange={(e) => {
              void enviar(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={<ImagePlus className="size-4" />}
              loading={por.isPending}
              onClick={() => entrada.current?.click()}
            >
              {atual ? 'Substituir' : 'Enviar logomarca'}
            </Button>
            {atual && (
              <Button
                size="sm"
                icon={<Trash2 className="size-4" />}
                loading={tirar.isPending}
                onClick={() => tirar.mutate({ params: { slot: String(slot) } })}
              >
                Remover
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
