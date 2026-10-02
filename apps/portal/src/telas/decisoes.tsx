/**
 * Aurora — o que o cliente DECIDE pelo portal (gap V2 P1.1, P1.2, P2.8).
 *
 * Três peças pequenas, usadas pelas telas que já existem:
 *
 *  · decidir sobre o orçamento que aguarda (aprovar, ou recusar com motivo);
 *  · baixar o documento liberado em PDF;
 *  · avaliar o atendimento depois de terminado.
 *
 * Nenhuma delas decide nada sozinha: o servidor confere o recorte do vínculo,
 * a situação do orçamento e se o atendimento terminou. A tela só não oferece
 * o que o servidor recusaria.
 */
import { useState } from 'react';
import { Check, Download, Star, X } from 'lucide-react';
import { Button, Field, Select, Textarea, cn } from '@aurora/ui';
import { ApiError, useApi, useApiMutation, useApiQuery } from '@aurora/app-kit';
import {
  portalDocumentPdf,
  portalHome,
  portalQuoteDecision,
  portalQuotes,
  portalRateRequest,
  portalRejectionReasons,
  portalRequestDetail,
  portalRequests,
  type PortalDocument,
  type PortalQuote,
  type PortalRequest,
} from '@aurora/contracts';

/* -------------------------------------------------------------------------- */
/* Orçamento                                                                   */
/* -------------------------------------------------------------------------- */

export function DecisaoDoOrcamento({ quote }: { quote: PortalQuote }) {
  const [modo, setModo] = useState<'nada' | 'recusar'>('nada');
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const decidir = useApiMutation(portalQuoteDecision, {
    invalidates: [portalQuotes, portalHome],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  if (modo === 'recusar') {
    return (
      <RecusaDoOrcamento
        motivo={motivo}
        nota={nota}
        erro={erro}
        enviando={decidir.isPending}
        onMotivo={setMotivo}
        onNota={setNota}
        onCancelar={() => {
          setModo('nada');
          setErro(null);
        }}
        onConfirmar={() => {
          setErro(null);
          if (!motivo) {
            setErro('Escolha o motivo da recusa.');
            return;
          }
          decidir.mutate({
            params: { id: quote.id },
            body: { decision: 'reject', rejection_reason_id: motivo, note: nota.trim() || undefined },
          });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => setModo('recusar')}>
          Recusar
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Check className="size-4" />}
          loading={decidir.isPending}
          onClick={() => {
            setErro(null);
            decidir.mutate({ params: { id: quote.id }, body: { decision: 'approve' } });
          }}
        >
          Aprovar
        </Button>
      </div>
      {erro && (
        <p role="alert" className="text-xs text-bad-text">
          {erro}
        </p>
      )}
    </div>
  );
}

function RecusaDoOrcamento(props: {
  motivo: string;
  nota: string;
  erro: string | null;
  enviando: boolean;
  onMotivo: (v: string) => void;
  onNota: (v: string) => void;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const { data } = useApiQuery(portalRejectionReasons, undefined, { staleTime: 10 * 60_000 }) as {
    data: { items: Array<{ id: string; label: string }> } | undefined;
  };
  return (
    <div className="flex w-full flex-col gap-3 pt-2">
      <Field label="Motivo da recusa" required error={props.erro}>
        <Select value={props.motivo} onChange={(e) => props.onMotivo(e.target.value)}>
          <option value="">Escolha…</option>
          {(data?.items ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Comentário" hint="Opcional. Ajuda a equipe a refazer a proposta.">
        <Textarea value={props.nota} onChange={(e) => props.onNota(e.target.value)} rows={2} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={props.onCancelar}>
          Voltar
        </Button>
        <Button size="sm" variant="danger" loading={props.enviando} onClick={props.onConfirmar}>
          Confirmar recusa
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Documento em PDF                                                            */
/* -------------------------------------------------------------------------- */

export function BaixarDocumento({ doc }: { doc: PortalDocument }) {
  const api = useApi();
  const [estado, setEstado] = useState<'pronto' | 'baixando' | 'erro'>('pronto');

  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Baixar ${doc.title || doc.type_name} em PDF`}
      icon={<Download className="size-4" />}
      loading={estado === 'baixando'}
      className={cn(estado === 'erro' && 'text-bad-text')}
      onClick={async () => {
        setEstado('baixando');
        try {
          const arquivo = (await api.call(portalDocumentPdf, { params: { id: doc.id } })) as unknown as Blob;
          const url = URL.createObjectURL(arquivo);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(doc.number ?? 'documento').replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          setEstado('pronto');
        } catch {
          setEstado('erro');
        }
      }}
    >
      {estado === 'erro' ? 'Tentar de novo' : 'PDF'}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Avaliação                                                                   */
/* -------------------------------------------------------------------------- */

const TERMINOU = new Set(['fulfilled', 'closed']);

export function AvaliacaoDoAtendimento({ request }: { request: PortalRequest }) {
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const avaliar = useApiMutation(portalRateRequest, {
    invalidates: [portalRequestDetail, portalRequests],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  if (!TERMINOU.has(request.status)) return null;

  if (request.rating != null) {
    return (
      <p className="text-sm text-muted">
        Sua avaliação: <strong className="text-text">{request.rating} de 5</strong>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text">Como foi este atendimento?</p>
      <div role="radiogroup" aria-label="Nota de 1 a 5" className="flex gap-1">
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
        loading={avaliar.isPending}
        onClick={() => {
          setErro(null);
          if (nota === null) {
            setErro('Escolha uma nota de 1 a 5.');
            return;
          }
          avaliar.mutate({
            params: { id: request.id },
            body: { rating: nota, comment: comentario.trim() || undefined },
          });
        }}
      >
        Enviar avaliação
      </Button>
    </div>
  );
}
