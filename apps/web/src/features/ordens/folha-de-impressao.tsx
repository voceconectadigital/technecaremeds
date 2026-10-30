/**
 * Aurora — a folha de impressão da ordem de serviço (OS-20 e OS-26 da auditoria de 29/10/2026).
 *
 * "Imprimir ordem de serviço completa: dados técnicos, check-in, checklist, parecer, anexos e
 * aprovação conforme existência real."
 *
 * A ficha tem abas, e o Imprimir do navegador só levava a aba aberta. Esta é a folha ÚNICA: tudo o
 * que a OS registrou, numa página que flui no papel. Cada seção aparece quando EXISTE dado — uma OS
 * sem peça não imprime uma tabela vazia de peças, e um laudo de obsolescência imprime a
 * justificativa e a assinatura de quem o validou.
 *
 * Usa a impressão do navegador (como o resto da aplicação): "Salvar como PDF" no diálogo do
 * sistema dá o arquivo. Não há geração no servidor para manter.
 *
 * As assinaturas são pela SESSÃO (resumo SHA-256, e-mail, IP e hora): provam quem e sobre o quê,
 * não são ICP-Brasil e não afirmam validade jurídica — o texto da folha diz isso.
 */
import { useEffect, type ReactNode } from 'react';
import {
  workOrderAttachments,
  workOrderChecklists,
  workOrderCustomerParts,
  workOrderEvaluation,
  workOrderParts,
  workOrderSignatures,
  workOrderTimeEntries,
  workOrderVisits,
  type Attachment,
  type TimeEntry,
  type WorkOrderChecklist,
  type WorkOrderCustomerPart,
  type WorkOrderDetail,
  type WorkOrderEvaluationView,
  type WorkOrderPart,
  type WorkOrderSignature,
  type WorkOrderVisit,
} from '@aurora/contracts';
import { useApiQuery } from '@aurora/app-kit';

type Q<T> = { data: T | undefined; isLoading: boolean };

const ROTULO_ANEXO: Record<string, string> = {
  before: 'Foto antes',
  after: 'Foto depois',
  evidence: 'Evidência',
  document: 'Documento / manual',
  signature: 'Assinatura',
  other: 'Outro',
};

const ROTULO_PAPEL: Record<string, string> = {
  technician: 'Técnico',
  customer: 'Cliente / solicitante',
  supervisor: 'Validação',
};

const ROTULO_METODO: Record<string, string> = {
  drawn: 'assinatura desenhada',
  email_code: 'código por e-mail',
  session: 'sessão autenticada',
};

function dataHora(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('pt-BR');
}

/** A resposta de um item do checklist, em texto. */
export function valorDaResposta(r: WorkOrderChecklist['answers'][number] | undefined): string {
  if (!r) return 'sem resposta';
  if (r.value_text) return r.value_text;
  if (r.value_number !== null) return String(r.value_number);
  if (r.value_boolean !== null) return r.value_boolean ? 'Sim' : 'Não';
  if (r.value_options && r.value_options.length > 0) return r.value_options.join(', ');
  if (r.value_date) return r.value_date;
  if (r.photo_count) return `${r.photo_count} foto(s)`;
  return '—';
}

function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={`folha-${id}`}
      data-secao={id}
      className="flex flex-col gap-2 border-t border-border-subtle pt-4"
      style={{ breakInside: 'avoid' }}
    >
      <h2 id={`folha-${id}`} className="text-base font-semibold text-text">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{rotulo}</dt>
      <dd className="text-sm break-words whitespace-pre-wrap text-text">
        {valor || <span className="text-subtle">—</span>}
      </dd>
    </div>
  );
}

/** As consultas da folha: a ficha usa para saber quando está tudo carregado e mandar imprimir. */
export function useDadosDaFolha(id: string) {
  const visitas = useApiQuery(workOrderVisits, { params: { id } }) as Q<{ items: WorkOrderVisit[] }>;
  const checklists = useApiQuery(workOrderChecklists, { params: { id } }) as Q<{
    items: WorkOrderChecklist[];
  }>;
  const pecas = useApiQuery(workOrderParts, { params: { id } }) as Q<{ items: WorkOrderPart[] }>;
  const doCliente = useApiQuery(workOrderCustomerParts, { params: { id } }) as Q<{
    items: WorkOrderCustomerPart[];
  }>;
  const anexos = useApiQuery(workOrderAttachments, { params: { id } }) as Q<{ items: Attachment[] }>;
  const horas = useApiQuery(workOrderTimeEntries, { params: { id } }) as Q<{
    items: TimeEntry[];
    total_minutes: number;
  }>;
  const avaliacao = useApiQuery(workOrderEvaluation, { params: { id } }) as Q<{
    evaluation: WorkOrderEvaluationView | null;
  }>;
  const assinaturas = useApiQuery(workOrderSignatures, { params: { id } }) as Q<{
    items: WorkOrderSignature[];
  }>;
  const carregando = [visitas, checklists, pecas, doCliente, anexos, horas, avaliacao, assinaturas].some(
    (q) => q.isLoading
  );
  return { visitas, checklists, pecas, doCliente, anexos, horas, avaliacao, assinaturas, carregando };
}

export function FolhaDeImpressao({ os, onPronta }: { os: WorkOrderDetail; onPronta?: () => void }) {
  const d = useDadosDaFolha(os.id);
  // Avisa quando tudo chegou: imprimir antes disso levaria seções em branco ao papel.
  useEffect(() => {
    if (!d.carregando) onPronta?.();
  }, [d.carregando, onPronta]);
  const laudo = os.number?.startsWith('OBC-') ?? false;
  const visitas = d.visitas.data?.items ?? [];
  const listas = d.checklists.data?.items ?? [];
  const pecas = d.pecas.data?.items ?? [];
  const doCliente = d.doCliente.data?.items ?? [];
  const anexos = d.anexos.data?.items ?? [];
  const avaliacao = d.avaliacao.data?.evaluation ?? null;
  const assinaturas = d.assinaturas.data?.items ?? [];
  const minutos = d.horas.data?.total_minutes ?? 0;

  return (
    <article
      aria-label={laudo ? 'Folha de impressão do laudo' : 'Folha de impressão da ordem de serviço'}
      data-testid="folha-de-impressao"
      className="mx-auto flex max-w-4xl flex-col gap-4 rounded-card border border-border bg-surface p-6 text-text"
    >
      <header className="flex flex-col gap-1">
        <p className="text-xs tracking-label text-subtle uppercase">
          {laudo ? 'Laudo de obsolescência' : 'Ordem de serviço'}
        </p>
        <h1 className="text-xl font-semibold">
          {os.number ?? 'sem número'} · {os.title}
        </h1>
        <p className="text-sm text-muted">
          {os.customer_name} · situação: {os.status_label} · emitida em {new Date().toLocaleString('pt-BR')}
        </p>
      </header>

      <Secao id="dados" titulo="Dados técnicos">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Campo rotulo="Cliente" valor={os.customer_name} />
          <Campo rotulo="Equipamento" valor={os.asset_name_snapshot} />
          <Campo rotulo="Patrimônio / série" valor={os.asset_serial_snapshot} />
          <Campo rotulo="Local" valor={os.location_name_snapshot} />
          <Campo rotulo="Natureza" valor={os.work_order_type_label} />
          <Campo rotulo="Criticidade" valor={os.criticality_label} />
          <Campo rotulo="Responsável" valor={os.assignee_name ?? os.team_name} />
          <Campo rotulo="Solicitação" valor={os.service_request_number} />
          <Campo rotulo="Aberta por" valor={os.created_by_name} />
          <Campo rotulo="Aberta em" valor={dataHora(os.created_at)} />
          <Campo rotulo="Iniciada em" valor={dataHora(os.started_at)} />
          <Campo rotulo="Concluída em" valor={dataHora(os.completed_at)} />
        </dl>
        <dl className="grid gap-2">
          <Campo rotulo={laudo ? 'Justificativa técnica' : 'Defeito relatado'} valor={os.description} />
          {os.reported_failure_label && <Campo rotulo="Sintoma relatado" valor={os.reported_failure_label} />}
        </dl>
      </Secao>

      {visitas.length > 0 && (
        <Secao id="checkin" titulo="Check-in e check-out">
          <ul className="flex flex-col gap-1 text-sm">
            {visitas.map((v) => (
              <li key={v.id}>
                {v.kind === 'check_in' ? 'Check-in' : 'Check-out'} · {v.person_name ?? '—'} ·{' '}
                {dataHora(v.occurred_at)} ·{' '}
                {v.position_source === 'device'
                  ? `posição ${v.latitude?.toFixed(5)}, ${v.longitude?.toFixed(5)}${
                      v.accuracy_m ? ` (±${Math.round(v.accuracy_m)} m)` : ''
                    }`
                  : `sem posição: ${v.justification ?? '—'}`}
              </li>
            ))}
          </ul>
          {minutos > 0 && <p className="text-sm text-muted">Tempo apontado: {minutos} min.</p>}
        </Secao>
      )}

      {listas.length > 0 && (
        <Secao id="checklist" titulo="Procedimento / checklist">
          {listas.map((c) => (
            <table key={c.id} className="w-full border-collapse text-sm">
              <caption className="py-1 text-left text-xs text-muted">
                {c.template_key} · versão {c.template_version}
              </caption>
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs text-subtle">
                  <th className="py-1 pr-2 font-medium">Item</th>
                  <th className="py-1 pr-2 font-medium">Resposta</th>
                  <th className="py-1 font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((item) => {
                  const r = c.answers.find((a) => a.item_id === item.id);
                  return (
                    <tr key={item.id} className="border-b border-border-subtle align-top">
                      <td className="py-1 pr-2">
                        {item.label}
                        {item.required ? ' *' : ''}
                      </td>
                      <td className="py-1 pr-2">
                        {valorDaResposta(r)}
                        {r && item.unit ? ` ${item.unit}` : ''}
                      </td>
                      <td className="py-1">
                        {r?.verdict === 'pass' ? 'aprovado' : r?.verdict === 'fail' ? 'reprovado' : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </Secao>
      )}

      <Secao id="servico" titulo="Serviço executado">
        <dl className="grid gap-2">
          <Campo rotulo="Descrição do serviço" valor={os.service_description ?? os.resolution} />
          {os.service_observations && <Campo rotulo="Observações" valor={os.service_observations} />}
          {os.cause_failure_label && <Campo rotulo="Causa" valor={os.cause_failure_label} />}
          {os.action_label && <Campo rotulo="Ação tomada" valor={os.action_label} />}
        </dl>
      </Secao>

      {(os.operational_result || os.final_opinion) && (
        <Secao id="parecer" titulo="Parecer técnico">
          <dl className="grid gap-2">
            <Campo
              rotulo="Situação de uso do equipamento"
              valor={
                os.operational_result === 'released'
                  ? 'LIBERADO PARA USO'
                  : os.operational_result === 'stopped'
                    ? 'EQUIPAMENTO PARADO'
                    : null
              }
            />
            {os.final_opinion && <Campo rotulo="Parecer" valor={os.final_opinion} />}
          </dl>
        </Secao>
      )}

      {pecas.length + doCliente.length > 0 && (
        <Secao id="pecas" titulo="Peças">
          <ul className="flex flex-col gap-1 text-sm">
            {pecas.map((p) => (
              <li key={p.id}>
                {p.item_name ?? 'Item removido do cadastro'} · {p.kind === 'return' ? '−' : ''}
                {p.qty} {p.unit ?? ''} · {p.kind === 'return' ? 'devolvida' : 'do estoque'}
              </li>
            ))}
            {doCliente.map((p) => (
              <li key={p.id}>
                {p.description} · {p.quantity} {p.unit ?? ''} · fornecida pelo cliente
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {anexos.length > 0 && (
        <Secao id="anexos" titulo="Anexos">
          <ul className="flex flex-col gap-1 text-sm">
            {anexos.map((a) => (
              <li key={a.id}>
                {ROTULO_ANEXO[a.purpose] ?? a.purpose} · {a.file_name} · {dataHora(a.uploaded_at)}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {avaliacao && (
        <Secao id="avaliacao" titulo="Avaliação do atendimento">
          <p className="text-sm">
            Nota {avaliacao.rating} de 5, por {avaliacao.evaluator_name} em {dataHora(avaliacao.evaluated_at)}
            .
          </p>
          {avaliacao.comment && <p className="text-sm whitespace-pre-wrap">{avaliacao.comment}</p>}
        </Secao>
      )}

      {assinaturas.length > 0 && (
        <Secao id="assinaturas" titulo="Assinaturas">
          <ul className="flex flex-col gap-2 text-sm">
            {assinaturas.map((s) => (
              <li key={s.id}>
                <strong>{ROTULO_PAPEL[s.signer_role] ?? s.signer_role}:</strong> {s.signer_name}
                {s.signer_email ? ` <${s.signer_email}>` : ''} · {dataHora(s.signed_at)} ·{' '}
                {ROTULO_METODO[s.method] ?? s.method}
                {s.client_ip ? ` · IP ${s.client_ip}` : ''}
                <span className="block font-mono text-xs break-all text-muted">
                  SHA-256 {s.signed_content_sha256}
                  {s.still_valid ? '' : ' · a OS mudou depois desta assinatura'}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Assinatura pela sessão autenticada: registra quem assinou, quando, de onde e o resumo do que foi
            assinado. Não é assinatura ICP-Brasil.
          </p>
        </Secao>
      )}

      {/* Os espaços para assinar à mão, só no papel. */}
      <div className="hidden grid-cols-2 gap-8 pt-10 text-xs text-muted print:grid">
        <p className="border-t border-text pt-1 text-center">Técnico responsável</p>
        <p className="border-t border-text pt-1 text-center">{laudo ? 'Validação do laudo' : 'Cliente'}</p>
      </div>
    </article>
  );
}
