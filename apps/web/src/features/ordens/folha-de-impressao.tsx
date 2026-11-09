/**
 * Aurora — a folha de impressão da ordem de serviço (OS-20 e OS-26 da auditoria de 29/10/2026;
 * refinada em 08/11/2026 com as duas referências de layout enviadas por Anderson).
 *
 * "Imprimir ordem de serviço completa: dados técnicos, check-in, checklist, parecer, anexos e
 * aprovação conforme existência real." Vale para QUALQUER natureza — corretiva, preventiva,
 * calibração, TSE, qualificação, instrução técnica, treinamento — e para o laudo de obsolescência.
 *
 * As referências entram como DIAGRAMAÇÃO (cabeçalho com a identidade, faixa situação/tipo/
 * prioridade, seções numeradas, rodapé), nunca como dado: nome, CNPJ, endereço, contatos,
 * hospitais e assinaturas vêm da organização logada e da própria OS. "Não informado" é campo que
 * a OS poderia ter e não tem; "Não se aplica" é campo que não cabe (equipamento numa OS de local).
 *
 * Cada seção opcional aparece quando EXISTE dado — uma OS sem peça não imprime uma tabela vazia
 * de peças. Os procedimentos imprimem as respostas reais e, nos pontos de medição (calibração/TSE),
 * as leituras registradas com nominal e tolerância declarados — sem veredito inventado.
 *
 * Usa a impressão do navegador: "Salvar como PDF" no diálogo do sistema dá o arquivo. A página é
 * A4 com margens próprias (`@page folha-os` em styles.css) e as seções não se partem no meio.
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
import { MARCA, useApiQuery, useSessionQuery } from '@aurora/app-kit';

type Q<T> = { data: T | undefined; isLoading: boolean };

const NAO_INFORMADO = 'Não informado';
const NAO_SE_APLICA = 'Não se aplica';

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

const ROTULO_PRIORIDADE: Record<string, string> = {
  emergency: 'Emergência',
  very_urgent: 'Muito urgente',
  urgent: 'Urgente',
  low: 'Baixa',
  none: 'Sem prioridade',
};

const ROTULO_ORIGEM: Record<string, string> = {
  request: 'Solicitação',
  plan: 'Plano de manutenção',
  manual: 'Abertura manual',
  inspection: 'Inspeção',
  automation: 'Automação',
};

function dataHora(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('pt-BR');
}

/** "03h12min": a duração entre dois instantes, ou nulo quando falta um deles. */
export function duracao(inicio: string | null | undefined, fim: string | null | undefined): string | null {
  if (!inicio || !fim) return null;
  const ms = new Date(fim).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutos = Math.round(ms / 60_000);
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}min`;
}

type Resposta = WorkOrderChecklist['answers'][number];
type Item = WorkOrderChecklist['items'][number];

/** A resposta de um item do checklist, em texto. */
export function valorDaResposta(r: Resposta | undefined): string {
  if (!r) return 'sem resposta';
  if (r.value_readings && r.value_readings.length > 0) {
    return r.value_readings.map((v) => String(v).replace('.', ',')).join(' · ');
  }
  if (r.value_text) return r.value_text;
  if (r.value_number !== null) return String(r.value_number);
  if (r.value_boolean !== null) return r.value_boolean ? 'Sim' : 'Não';
  if (r.value_options && r.value_options.length > 0) return r.value_options.join(', ');
  if (r.value_date) return r.value_date;
  if (r.photo_count) return `${r.photo_count} foto(s)`;
  return '—';
}

/** O critério declarado do ponto de medição: nominal e tolerância, como DADO (sem veredito). */
export function criterioDoPonto(item: Item): string | null {
  const i = item as Item & {
    nominalValue?: number | null;
    toleranceMinus?: number | null;
    tolerancePlus?: number | null;
    toleranceMode?: string | null;
  };
  if (i.nominalValue === null || i.nominalValue === undefined) return null;
  const un = i.unit ? ` ${i.unit}` : '';
  const pct = i.toleranceMode === 'percent';
  const tol =
    i.toleranceMinus !== null &&
    i.toleranceMinus !== undefined &&
    i.tolerancePlus !== null &&
    i.tolerancePlus !== undefined
      ? ` (−${i.toleranceMinus}${pct ? '%' : un} / +${i.tolerancePlus}${pct ? '%' : un})`
      : '';
  return `nominal ${i.nominalValue}${un}${tol}`;
}

function Secao({
  id,
  numero,
  titulo,
  children,
}: {
  id: string;
  numero?: number;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`folha-${id}`}
      data-secao={id}
      className="flex flex-col gap-2 pt-3"
      style={{ breakInside: 'avoid' }}
    >
      <h2
        id={`folha-${id}`}
        className="border-b border-border-subtle pb-1 text-sm font-bold tracking-label text-text uppercase"
      >
        {numero !== undefined && (
          <span className="mr-1.5 text-brand" aria-hidden="true">
            {String(numero).padStart(2, '0')}
          </span>
        )}
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Campo({
  rotulo,
  valor,
  vazio = NAO_INFORMADO,
}: {
  rotulo: string;
  valor: ReactNode;
  vazio?: string;
}) {
  const temValor = valor !== null && valor !== undefined && valor !== '';
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-semibold tracking-label text-subtle uppercase">{rotulo}</dt>
      <dd className="text-sm break-words whitespace-pre-wrap text-text">
        {temValor ? valor : <span className="text-subtle">{vazio}</span>}
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
  const { data: sessao } = useSessionQuery();
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
  const temEquipamento = Boolean(os.asset_id);
  // O nome da organização que emite (a logada), sem o marcador de ambiente "[Homologação] ".
  const emissora = (sessao?.organization.name ?? '').replace(/^\[[^\]]+\]\s*/, '') || MARCA.produto;
  const aceite = assinaturas.find((s) => s.signer_role === 'customer') ?? null;
  const executor = os.assignee_name ?? os.team_name ?? null;

  // A numeração acompanha as seções que de fato saem no papel.
  let n = 0;
  const proximo = () => ++n;

  return (
    <article
      aria-label={laudo ? 'Folha de impressão do laudo' : 'Folha de impressão da ordem de serviço'}
      data-testid="folha-de-impressao"
      className="aurora-folha-os mx-auto flex max-w-4xl flex-col gap-3 rounded-card border border-border bg-surface p-6 text-text print:max-w-none print:rounded-none print:border-0 print:p-0"
    >
      <header className="flex flex-col gap-3" style={{ breakInside: 'avoid' }}>
        <div className="flex items-start justify-between gap-4 border-b-2 border-brand pb-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-text">{emissora}</p>
            <p className="text-xs text-muted">Emitido pelo sistema {MARCA.produto}</p>
          </div>
          <img src={MARCA.logoHorizontal} alt={MARCA.produto} className="h-9 w-auto shrink-0" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-2xl leading-tight font-bold tracking-tight uppercase">
              {laudo ? 'Laudo de obsolescência' : 'Ordem de serviço'}
            </p>
            <p className="text-xs text-muted">
              {laudo ? 'Laudo técnico' : 'Relatório de atendimento técnico'} · {os.title}
            </p>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-bold tabular-nums">{os.number ?? 'sem número'}</h1>
            <p className="text-xs text-muted">Emitida em {new Date().toLocaleString('pt-BR')}</p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-4 rounded-control border border-border-subtle bg-surface-subtle px-3 py-2 print:bg-transparent">
          <Campo rotulo="Situação da OS" valor={os.status_label} />
          <Campo rotulo="Tipo de atendimento" valor={os.work_order_type_label} />
          <Campo rotulo="Prioridade" valor={ROTULO_PRIORIDADE[os.priority] ?? os.priority} />
        </dl>
      </header>

      <Secao id="cliente" numero={proximo()} titulo="Cliente e local do atendimento">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Campo rotulo="Cliente" valor={os.customer_name} />
          <Campo rotulo="Unidade / setor" valor={os.location_name_snapshot} />
          <Campo rotulo="Origem" valor={os.source ? (ROTULO_ORIGEM[os.source] ?? os.source) : null} />
          <Campo
            rotulo="Solicitação de origem"
            valor={os.service_request_number}
            vazio={os.source === 'request' ? NAO_INFORMADO : NAO_SE_APLICA}
          />
          <Campo rotulo="Aberta por" valor={os.created_by_name} />
          <Campo rotulo="Criticidade" valor={os.criticality_label} />
        </dl>
      </Secao>

      <Secao id="equipamento" numero={proximo()} titulo="Identificação do equipamento">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Campo
            rotulo="Equipamento"
            valor={os.asset_name_snapshot}
            vazio={temEquipamento ? NAO_INFORMADO : NAO_SE_APLICA}
          />
          <Campo
            rotulo="Patrimônio / série"
            valor={os.asset_serial_snapshot}
            vazio={temEquipamento ? NAO_INFORMADO : NAO_SE_APLICA}
          />
          <Campo rotulo="Setor / localização" valor={os.location_name_snapshot} />
        </dl>
      </Secao>

      <Secao id="servico" numero={proximo()} titulo="Registro técnico do atendimento">
        <dl className="grid gap-2">
          <Campo rotulo={laudo ? 'Justificativa técnica' : 'Problema relatado'} valor={os.description} />
          {os.reported_failure_label && <Campo rotulo="Sintoma relatado" valor={os.reported_failure_label} />}
          {!laudo && <Campo rotulo="Diagnóstico / causa" valor={os.cause_failure_label} />}
          <Campo rotulo="Serviço executado" valor={os.service_description ?? os.resolution} />
          {os.action_label && <Campo rotulo="Ação tomada" valor={os.action_label} />}
          {os.service_observations && <Campo rotulo="Observações" valor={os.service_observations} />}
        </dl>
      </Secao>

      {listas.length > 0 && (
        <Secao id="checklist" numero={proximo()} titulo="Procedimentos, testes e medições">
          {listas.map((c) => (
            <table key={c.id} className="w-full border-collapse text-sm" style={{ breakInside: 'auto' }}>
              <caption className="py-1 text-left text-xs font-semibold text-text">
                {c.template_title ?? c.template_key} · versão {c.template_version}
              </caption>
              <thead>
                <tr className="border-b border-border-subtle text-left text-2xs text-subtle uppercase">
                  <th className="py-1 pr-2 font-semibold">Item</th>
                  <th className="py-1 pr-2 font-semibold">Resposta / leituras</th>
                  <th className="py-1 font-semibold">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((item) => {
                  const r = c.answers.find((a) => a.item_id === item.id);
                  const criterio = item.kind === 'measurement' ? criterioDoPonto(item) : null;
                  const unidade = r?.unit ?? item.unit;
                  return (
                    <tr
                      key={item.id}
                      className="border-b border-border-subtle align-top"
                      style={{ breakInside: 'avoid' }}
                    >
                      <td className="py-1 pr-2">
                        {item.label}
                        {item.required ? ' *' : ''}
                        {criterio && <span className="block text-xs text-muted">{criterio}</span>}
                      </td>
                      <td className="py-1 pr-2">
                        {valorDaResposta(r)}
                        {r && unidade && valorDaResposta(r) !== '—' ? ` ${unidade}` : ''}
                      </td>
                      <td className="py-1">
                        {r?.verdict === 'pass'
                          ? 'aprovado'
                          : r?.verdict === 'fail'
                            ? 'reprovado'
                            : item.kind === 'measurement' && r
                              ? 'registrado (sem veredito automático)'
                              : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
          <p className="text-xs text-muted">
            * item obrigatório. Pontos de medição mostram as leituras registradas e o critério declarado no
            procedimento; o sistema não emite veredito metrológico.
          </p>
        </Secao>
      )}

      <Secao id="datas" numero={proximo()} titulo="Datas e tempo de atendimento">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Campo rotulo="Abertura" valor={dataHora(os.created_at)} />
          <Campo rotulo="Início do atendimento" valor={dataHora(os.started_at)} />
          <Campo rotulo="Término do atendimento" valor={dataHora(os.completed_at)} />
          <Campo rotulo="Tempo decorrido" valor={duracao(os.started_at, os.completed_at)} />
          {os.validated_at && <Campo rotulo="Validada em" valor={dataHora(os.validated_at)} />}
          {os.closed_at && <Campo rotulo="Fechada em" valor={dataHora(os.closed_at)} />}
          {minutos > 0 && <Campo rotulo="Tempo apontado" valor={`${minutos} min`} />}
        </dl>
      </Secao>

      {visitas.length > 0 && (
        <Secao id="checkin" numero={proximo()} titulo="Check-in e check-out">
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
        </Secao>
      )}

      {(os.operational_result || os.final_opinion) && (
        <Secao id="parecer" numero={proximo()} titulo="Condição final e parecer técnico">
          <dl className="grid gap-2 rounded-control border-l-4 border-brand bg-surface-subtle px-3 py-2 print:bg-transparent">
            <Campo
              rotulo="Situação de uso do equipamento"
              valor={
                os.operational_result === 'released'
                  ? 'LIBERADO PARA USO'
                  : os.operational_result === 'stopped'
                    ? 'EQUIPAMENTO PARADO'
                    : null
              }
              vazio={temEquipamento ? NAO_INFORMADO : NAO_SE_APLICA}
            />
            {os.final_opinion && <Campo rotulo="Parecer" valor={os.final_opinion} />}
          </dl>
        </Secao>
      )}

      {pecas.length + doCliente.length > 0 && (
        <Secao id="pecas" numero={proximo()} titulo="Peças">
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
        <Secao id="anexos" numero={proximo()} titulo="Anexos">
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
        <Secao id="avaliacao" numero={proximo()} titulo="Avaliação do atendimento">
          <p className="text-sm">
            Nota {avaliacao.rating} de 5, por {avaliacao.evaluator_name} em {dataHora(avaliacao.evaluated_at)}
            .
          </p>
          {avaliacao.comment && <p className="text-sm whitespace-pre-wrap">{avaliacao.comment}</p>}
        </Secao>
      )}

      <Secao id="responsaveis" numero={proximo()} titulo="Responsáveis e aceite">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <div className="rounded-control border border-border-subtle p-3">
            <Campo rotulo="Profissional executor" valor={executor} />
            <p className="mt-1 text-xs text-muted">
              {executor ? 'Responsável atribuído na OS.' : 'Responsável não atribuído na OS.'}
            </p>
          </div>
          <div className="rounded-control border border-border-subtle p-3">
            <Campo rotulo="Recebimento / ciência do cliente" valor={aceite?.signer_name ?? null} />
            <p className="mt-1 text-xs text-muted">
              {aceite
                ? `Aceite registrado no sistema em ${dataHora(aceite.signed_at)} (${ROTULO_METODO[aceite.method] ?? aceite.method}).`
                : 'Aceite não registrado no sistema.'}
            </p>
          </div>
        </dl>
      </Secao>

      {assinaturas.length > 0 && (
        <Secao id="assinaturas" titulo="Assinaturas registradas">
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
      <div
        className="hidden grid-cols-2 gap-8 pt-10 text-xs text-muted print:grid"
        style={{ breakInside: 'avoid' }}
      >
        <p className="border-t border-text pt-1 text-center">Técnico responsável</p>
        <p className="border-t border-text pt-1 text-center">{laudo ? 'Validação do laudo' : 'Cliente'}</p>
      </div>

      <footer className="mt-2 flex flex-wrap justify-between gap-2 border-t border-border-subtle pt-2 text-2xs text-subtle">
        <span>Confidencial · dados destinados ao atendimento e sujeitos à LGPD.</span>
        <span>
          {os.number ?? 'sem número'} · {emissora}
        </span>
      </footer>
    </article>
  );
}
