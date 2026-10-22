/**
 * Aurora — portal: avaliar e assinar as ordens de serviço concluídas (conversa com o
 * cliente, 21/10/2026).
 *
 * "Quando a pessoa logar, o sistema deve avisar em um campo específico de pendências todas as
 * ordens de serviço de qualquer tipo para avaliar/assinar. Sempre avaliar antes, e depois
 * assinar automático." Este bloco é o primeiro do início: a nota (1 a 5) e, no mesmo ato, a
 * assinatura da pessoa — sem uma segunda tela para assinar.
 */
import { useState } from 'react';
import { PenLine, Star } from 'lucide-react';
import { Button, Card, CardHeader, Field, Textarea, cn } from '@aurora/ui';
import { evaluationsPending, workOrderEvaluate, type PendingEvaluationRow } from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '@aurora/app-kit';

export function AvaliarEAssinarOs() {
  const { data } = useApiQuery(evaluationsPending) as {
    data: { items: PendingEvaluationRow[]; total: number } | undefined;
  };
  if (!data || data.total === 0) return null;

  return (
    <Card>
      <CardHeader
        title={
          data.total === 1
            ? '1 ordem de serviço para avaliar e assinar'
            : `${data.total} ordens de serviço para avaliar e assinar`
        }
        description="Avalie o atendimento; a sua assinatura é registrada na hora. Enquanto houver pendência, não é possível abrir um chamado novo."
      />
      <ul className="flex flex-col gap-3 p-3">
        {data.items.map((p) => (
          <li key={p.work_order_id}>
            <Avaliacao pendente={p} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Avaliacao({ pendente }: { pendente: PendingEvaluationRow }) {
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const avaliar = useApiMutation(workOrderEvaluate, {
    invalidates: [evaluationsPending],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-subtle p-3">
      <p className="text-sm text-text">
        <strong>{pendente.number ?? 'OS'}</strong> · {pendente.title}
        {pendente.asset_name ? ` · ${pendente.asset_name}` : ''}
      </p>
      <div
        role="radiogroup"
        aria-label={`Nota de 1 a 5 para ${pendente.number ?? 'a OS'}`}
        className="flex gap-1"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={nota === n}
            aria-label={`${n} de 5`}
            onClick={() => setNota(n)}
            className={cn(
              'flex size-11 items-center justify-center rounded-control border',
              nota !== null && n <= nota
                ? 'border-accent bg-accent-soft text-accent-text'
                : 'border-border text-subtle'
            )}
          >
            <Star aria-hidden="true" className="size-5" />
          </button>
        ))}
      </div>
      <Field label="Comentário" hint="Opcional.">
        <Textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} />
      </Field>
      {erro && (
        <p role="alert" className="text-xs text-bad-text">
          {erro}
        </p>
      )}
      <Button
        size="sm"
        variant="primary"
        className="self-end"
        icon={<PenLine className="size-4" aria-hidden="true" />}
        loading={avaliar.isPending}
        onClick={() => {
          setErro(null);
          if (nota === null) {
            setErro('Escolha uma nota de 1 a 5.');
            return;
          }
          avaliar.mutate({
            params: { id: pendente.work_order_id },
            body: { rating: nota, comment: comentario.trim() || undefined },
          });
        }}
      >
        Avaliar e assinar
      </Button>
    </div>
  );
}
