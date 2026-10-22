/**
 * Aurora — avaliar e assinar a ordem de serviço (conversa com o cliente, 21/10/2026).
 *
 * "Sempre avaliar antes, e depois assinar automático": a pessoa que pediu o atendimento dá a
 * nota (1 a 5) e, no mesmo ato, o sistema registra a assinatura dela. Aqui moram as duas
 * pontas da regra: o cartão da OS (avaliar, ou ver quem avaliou e quando) e o campo de
 * pendências da tela Hoje (o que ainda falta avaliar, de qualquer tipo de OS).
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { PenLine, Star } from 'lucide-react';
import { Button, Card, CardHeader, Field, Textarea, cn, useToast } from '@aurora/ui';
import {
  evaluationsPending,
  workOrderEvaluate,
  workOrderEvaluation,
  type PendingEvaluationRow,
  type WorkOrderEvaluationView,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '@aurora/app-kit';

/** As estrelas: nota de 1 a 5, acessível por teclado e por leitor de tela. */
export function Estrelas({
  valor,
  onChange,
  somenteLeitura = false,
}: {
  valor: number | null;
  onChange?: (n: number) => void;
  somenteLeitura?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Nota de 1 a 5" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={valor === n}
          aria-label={`${n} de 5`}
          disabled={somenteLeitura}
          onClick={() => onChange?.(n)}
          className={cn(
            'flex size-11 items-center justify-center rounded-control border',
            valor !== null && n <= valor
              ? 'border-accent bg-accent-soft text-accent-text'
              : 'border-border text-subtle',
            somenteLeitura && 'cursor-default'
          )}
        >
          <Star aria-hidden="true" className="size-5" />
        </button>
      ))}
    </div>
  );
}

/** O cartão da OS: avalia (se for a pessoa que pediu e ainda não avaliou) ou mostra a avaliação. */
export function AvaliacaoDaOs({ workOrderId }: { workOrderId: string }) {
  const toast = useToast();
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const { data } = useApiQuery(workOrderEvaluation, { params: { id: workOrderId } }) as {
    data: { evaluation: WorkOrderEvaluationView | null; can_evaluate: boolean } | undefined;
  };
  const avaliar = useApiMutation(workOrderEvaluate, {
    invalidates: [workOrderEvaluation, evaluationsPending],
    onError: (e: ApiError) => setErro(e.problem.message),
    onSuccess: () => toast.success('Avaliação enviada e assinada', 'Obrigado: ela já conta nos indicadores.'),
  });

  if (!data) return null;
  const { evaluation, can_evaluate: podeAvaliar } = data;
  // Nada a mostrar: ninguém avaliou e esta pessoa não é quem avalia.
  if (!evaluation && !podeAvaliar) return null;

  return (
    <Card>
      <CardHeader
        title="Avaliação e assinatura"
        description={
          evaluation
            ? 'Avaliada e assinada por quem pediu o atendimento.'
            : 'Avalie o atendimento: ao enviar, a sua assinatura é registrada.'
        }
      />
      <div className="flex flex-col gap-3 p-4">
        {evaluation ? (
          <>
            <Estrelas valor={evaluation.rating} somenteLeitura />
            {evaluation.comment && (
              <p className="text-sm whitespace-pre-wrap text-text">{evaluation.comment}</p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <PenLine aria-hidden="true" className="size-3.5" />
              Assinado por {evaluation.evaluator_name} em{' '}
              {new Date(evaluation.evaluated_at).toLocaleString('pt-BR')}
            </p>
          </>
        ) : (
          <>
            <Estrelas valor={nota} onChange={setNota} />
            <Field label="Comentário" hint="Opcional.">
              <Textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} />
            </Field>
            {erro && (
              <p role="alert" className="text-xs text-bad-text">
                {erro}
              </p>
            )}
            <Button
              variant="primary"
              size="sm"
              className="self-end"
              loading={avaliar.isPending}
              onClick={() => {
                setErro(null);
                if (nota === null) {
                  setErro('Escolha uma nota de 1 a 5.');
                  return;
                }
                avaliar.mutate({
                  params: { id: workOrderId },
                  body: { rating: nota, comment: comentario.trim() || undefined },
                });
              }}
            >
              Avaliar e assinar
            </Button>
          </>
        )}
      </div>
      {/* Só no papel: o espaço da assinatura de quem recebeu o serviço. */}
      <div className="hidden px-4 pb-6 print:block">
        <p className="mt-8 border-t border-black pt-1 text-xs">
          Assinatura de quem recebeu o serviço: {evaluation?.evaluator_name ?? '__________________________'}
        </p>
      </div>
    </Card>
  );
}

/**
 * O CAMPO DE PENDÊNCIAS da tela Hoje: toda OS, de qualquer tipo, que esta pessoa pediu, já foi
 * concluída e ela ainda não avaliou. Só aparece quando há pendência — e quando aparece, é o
 * primeiro bloco da tela, porque é a coisa que o cliente quer que a pessoa veja ao entrar.
 */
export function PendenciasDeAvaliacao() {
  const { data } = useApiQuery(evaluationsPending) as {
    data: { items: PendingEvaluationRow[]; total: number } | undefined;
  };
  if (!data || data.total === 0) return null;

  return (
    <section
      aria-labelledby="pendencias-de-avaliacao"
      className="rounded-card border border-warn bg-warn-soft p-4"
    >
      <h2 id="pendencias-de-avaliacao" className="text-base font-semibold text-warn-text">
        {data.total === 1
          ? '1 ordem de serviço aguarda a sua avaliação e assinatura'
          : `${data.total} ordens de serviço aguardam a sua avaliação e assinatura`}
      </h2>
      <p className="mt-1 text-sm text-warn-text">
        Avalie primeiro; a assinatura é registrada na hora. Enquanto houver pendência, não é possível abrir um
        chamado novo.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {data.items.map((p) => (
          <li key={p.work_order_id}>
            <Link
              to="/ordens/$id"
              params={{ id: p.work_order_id }}
              className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-control bg-surface px-3 py-2 text-sm hover:underline"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-text">{p.number ?? 'OS'}</span> · {p.title}
                {p.asset_name ? ` · ${p.asset_name}` : ''}
              </span>
              <span className="text-xs text-muted">{p.type_label ?? ''}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
