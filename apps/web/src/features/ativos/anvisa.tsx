/**
 * Aurora — registro ANVISA do equipamento (conversa com o cliente, 21/10/2026).
 *
 * O cartão mostra o número do registro, a situação da ÚLTIMA VERIFICAÇÃO (quem olhou e quando) e
 * um atalho para a consulta oficial. O sistema ainda não consulta a ANVISA sozinho, e a tela diz
 * isso — "regular" sem ninguém ter conferido seria afirmar o que ninguém sabe. Alerta e uso
 * proibido ficam em destaque, e avisam gestores e coordenadores.
 */
import { useState } from 'react';
import { ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button, Card, CardHeader, Dialog, Field, Select, StatusChip, Textarea, useToast } from '@aurora/ui';
import { assetAnvisaCheck, assetDetail, type AssetDetail } from '@aurora/contracts';
import { ApiError, Can, useApiMutation } from '@aurora/app-kit';

const ROTULOS = { regular: 'Regular', alert: 'Alerta', prohibited: 'Uso proibido' } as const;
const TONS = { regular: 'good', alert: 'warn', prohibited: 'bad' } as const;
const CONSULTA_OFICIAL = 'https://consultas.anvisa.gov.br/';

export function CartaoAnvisa({ ativo }: { ativo: AssetDetail }) {
  const [verificando, setVerificando] = useState(false);
  // "Não se aplica" (ATV-11 · 0089): dito, para não parecer cadastro esquecido.
  if (!ativo.anvisa_registration && ativo.anvisa_not_applicable) {
    return (
      <Card>
        <CardHeader title="Registro ANVISA" />
        <p className="p-4 text-sm text-muted">
          Não se aplica: este equipamento não tem registro ANVISA aplicável.
        </p>
      </Card>
    );
  }
  if (!ativo.anvisa_registration) return null;
  const status = ativo.anvisa_status ?? null;

  return (
    <Card>
      <CardHeader
        title="Registro ANVISA"
        description="Situação da última verificação feita por uma pessoa."
        actions={
          status && (
            <StatusChip tone={TONS[status]} size="sm">
              {ROTULOS[status]}
            </StatusChip>
          )
        }
      />
      <div className="flex flex-col gap-3 p-4 text-sm">
        {status === 'prohibited' && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 font-medium text-bad-text">
            <ShieldAlert aria-hidden="true" className="mr-1 inline size-4" />
            Uso proibido pela ANVISA: não utilize este equipamento até a regularização.
          </p>
        )}
        <p>
          <span className="text-xs text-subtle">Número do registro</span>
          <br />
          <span className="font-medium text-text tabular-nums">{ativo.anvisa_registration}</span>
        </p>
        {status ? (
          <>
            {ativo.anvisa_note && <p className="whitespace-pre-wrap text-text">{ativo.anvisa_note}</p>}
            <p className="text-xs text-muted">
              <ShieldCheck aria-hidden="true" className="mr-1 inline size-3.5" />
              Verificado em{' '}
              {ativo.anvisa_checked_at ? new Date(ativo.anvisa_checked_at).toLocaleDateString('pt-BR') : '—'}
            </p>
          </>
        ) : (
          <p className="text-muted">Ainda não verificado.</p>
        )}
        <p className="text-xs text-muted">
          O sistema não consulta a ANVISA sozinho: confira na consulta oficial e registre o resultado aqui.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={CONSULTA_OFICIAL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-border px-3 text-sm font-medium text-accent-text hover:underline"
          >
            Consultar na ANVISA
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
          <Can permission="asset.update">
            <Button size="sm" onClick={() => setVerificando(true)}>
              Registrar verificação
            </Button>
          </Can>
        </div>
      </div>
      {verificando && <DialogoVerificacao assetId={ativo.id} onFechar={() => setVerificando(false)} />}
    </Card>
  );
}

function DialogoVerificacao({ assetId, onFechar }: { assetId: string; onFechar: () => void }) {
  const toast = useToast();
  const [situacao, setSituacao] = useState<'regular' | 'alert' | 'prohibited'>('regular');
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const registrar = useApiMutation(assetAnvisaCheck, {
    invalidates: [assetDetail],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  const exigeNota = situacao !== 'regular';

  async function salvar() {
    setErro(null);
    if (exigeNota && !nota.trim()) {
      setErro('Descreva o alerta ou a proibição (número da notificação, motivo).');
      return;
    }
    try {
      const r = (await registrar.mutateAsync({
        params: { id: assetId },
        body: { status: situacao, note: nota.trim() || undefined },
      })) as { alerted: boolean };
      toast.success(
        'Verificação registrada',
        r.alerted ? 'Gestores e coordenadores foram avisados.' : undefined
      );
      onFechar();
    } catch {
      // A mensagem já está no formulário (onError).
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title="Registrar verificação ANVISA"
      description="Registre o que a consulta oficial mostrou. Alerta e proibição avisam gestores e coordenadores."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button variant="primary" loading={registrar.isPending} onClick={() => void salvar()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="O que a consulta mostrou">
          <Select value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)}>
            <option value="regular">Registro regular, sem alerta</option>
            <option value="alert">Há alerta ou notificação</option>
            <option value="prohibited">Uso proibido</option>
          </Select>
        </Field>
        <Field
          label={exigeNota ? 'Descrição (obrigatória)' : 'Observação'}
          hint={exigeNota ? 'Número da notificação ou da resolução, e o motivo.' : 'Opcional.'}
        >
          <Textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={4} maxLength={1000} />
        </Field>
        {erro && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}
