/**
 * Aurora — "Gerar laudo de obsolescência" (conversa com o cliente, 21/10/2026).
 *
 * Qualquer equipamento pode virar um laudo: uma ordem de serviço própria, numerada OBC-AAAA-NNNN,
 * com a justificativa técnica. Gerar o laudo NÃO desativa o equipamento — a tela diz isso, porque
 * a pergunta de quem clica é "e agora ele sai de operação?". A baixa acontece quando o laudo é
 * concluído (com foto) e validado.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FileWarning } from 'lucide-react';
import { Button, Dialog, Field, Textarea, useToast } from '@aurora/ui';
import { assetObsolescenceReport, assetDetail, assetsList } from '@aurora/contracts';
import { ApiError, useApiMutation } from '@aurora/app-kit';

const MINIMO = 20;

export function BotaoLaudoDeObsolescencia({ assetId, nome }: { assetId: string; nome: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button icon={<FileWarning className="size-4" />} onClick={() => setAberto(true)}>
        Gerar laudo de obsolescência
      </Button>
      {aberto && <DialogoLaudo assetId={assetId} nome={nome} onFechar={() => setAberto(false)} />}
    </>
  );
}

function DialogoLaudo({ assetId, nome, onFechar }: { assetId: string; nome: string; onFechar: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const gerar = useApiMutation(assetObsolescenceReport, {
    invalidates: [assetDetail, assetsList],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  const curta = justificativa.trim().length < MINIMO;

  async function salvar() {
    setErro(null);
    try {
      const r = (await gerar.mutateAsync({
        params: { id: assetId },
        body: { justification: justificativa.trim() },
      })) as { id: string; number: string | null };
      toast.success(
        `Laudo ${r.number ?? ''} gerado`,
        'O equipamento continua em operação até o laudo ser validado.'
      );
      onFechar();
      void navigate({ to: '/ordens/$id', params: { id: r.id } });
    } catch {
      // A mensagem já está no formulário (onError).
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      size="lg"
      title="Gerar laudo de obsolescência"
      description={nome}
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button variant="primary" loading={gerar.isPending} disabled={curta} onClick={() => void salvar()}>
            Gerar laudo
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p role="note" className="rounded-control bg-surface-sunken px-3 py-2 text-sm text-muted">
          O laudo é uma ordem de serviço própria (numeração <strong>OBC</strong>). Para concluí-lo é preciso
          anexar ao menos uma foto do equipamento; quando for validado, o equipamento é desativado com esta
          justificativa. Gerar o laudo, sozinho, não desativa nada.
        </p>
        <Field
          label="Justificativa técnica"
          hint={`Mínimo de ${MINIMO} caracteres: é o que quem valida lê. Ex.: idade, falta de peças, custo de reparo.`}
        >
          <Textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            rows={5}
            maxLength={4000}
          />
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
