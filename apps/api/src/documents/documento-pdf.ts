/**
 * Aurora — o documento técnico em PDF (gap V2 P2.8 · PLAT §6.2 passo 7).
 *
 * O PDF é uma REPRESENTAÇÃO. O que o sistema garante é o hash do conteúdo
 * (revisão → assinatura → emissão); o arquivo é a forma de entregá-lo a quem
 * lê. Por isso o rodapé imprime o hash e diz isso — um PDF editado depois
 * continua sendo conferível contra o registro.
 *
 * Documento NÃO EMITIDO sai com faixa em toda página e sem número: um rascunho
 * impresso não pode se passar por certificado.
 *
 * A marca técnica "Aurora" não aparece: quem emite é a ORGANIZAÇÃO, e é o nome
 * dela que vai no cabeçalho.
 */
import {
  VERDICT_LABELS,
  SESSION_SNAPSHOT_SCHEMA,
  SESSION_SNAPSHOT_KEY,
  type DocumentVerdict,
} from '@aurora/domain';
import { gerarPdf, type LinhaPdf } from './pdf';

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  under_review: 'Em revisão',
  issued: 'Emitido',
  released: 'Emitido e liberado ao cliente',
  expired: 'Vencido',
  cancelled: 'Cancelado',
  superseded: 'Substituído por versão nova',
};

/** Situações em que o documento tem valor de registro (número queimado e hash). */
const EMITIDO = new Set(['issued', 'released', 'expired']);

export interface DocumentoParaPdf {
  id: string;
  organization_name: string;
  type_label: string;
  number: string | null;
  version: number;
  status: string;
  title: string | null;
  verdict: string | null;
  issued_at: string | null;
  valid_until: string | null;
  asset_name: string | null;
  work_order_number: string | null;
  technical_manager_name: string | null;
  content_hash: string | null;
  payload: Record<string, unknown>;
  signatures: Array<{ signer_name: string; method: string; signed_at: string; valid: boolean }>;
}

const valor = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Data/instante em texto curto e estável (sem depender do fuso de quem gera). */
const quando = (v: string | null): string =>
  v ? v.replace('T', ' ').replace(/\.\d+/, '').replace('Z', ' UTC') : '—';

function secaoDaSessao(p: Record<string, unknown>, linhas: LinhaPdf[]) {
  const o = (k: string) => (p[k] ?? null) as Record<string, unknown> | null;

  const protocolo = o('protocol');
  linhas.push({ texto: 'Protocolo', titulo: true });
  linhas.push({
    texto: `${valor(protocolo?.title)} — chave ${valor(protocolo?.key)}, versão ${valor(protocolo?.version)}`,
  });
  linhas.push({ texto: `Tipo de procedimento: ${valor(protocolo?.procedure_kind)}` });
  const rt = protocolo?.technical_manager as Record<string, unknown> | null;
  linhas.push({ texto: `Responsável técnico do protocolo: ${valor(rt?.name)}` });

  const os = o('work_order');
  const ativo = o('asset');
  linhas.push({ texto: 'Sessão de medição', titulo: true });
  linhas.push({ texto: `OS: ${valor(os?.number)} · Equipamento: ${valor(ativo?.name)}` });
  linhas.push({
    texto: `Data da medição: ${valor(p.measured_on)} · início ${quando(p.started_at as string)} · fim ${quando(p.finished_at as string)}`,
  });
  const tec = o('technician');
  linhas.push({
    texto: `Técnico: ${valor(tec?.name)} · Origem das leituras: ${valor(p.measurement_source)}`,
  });

  const inst = o('instrument');
  linhas.push({ texto: 'Instrumento', titulo: true });
  if (inst) {
    linhas.push({ texto: `${valor(inst.name)} — ${valor(inst.manufacturer)} ${valor(inst.model)}` });
    linhas.push({ texto: `Série: ${valor(inst.serial_number)} · Tag: ${valor(inst.tag)}` });
  } else {
    linhas.push({ texto: 'Nenhum instrumento registrado na sessão.' });
  }

  const cert = o('instrument_certificate');
  linhas.push({ texto: 'Certificado do instrumento (emitido por laboratório externo)', titulo: true });
  if (cert) {
    linhas.push({ texto: `Nº ${valor(cert.number)} · ${valor(cert.laboratory)}` });
    linhas.push({
      texto: `Vigência: ${valor(cert.issued_on)} a ${valor(cert.valid_until)} · Rastreabilidade: ${valor(cert.traceability)}`,
    });
  } else {
    linhas.push({ texto: 'Nenhum certificado vinculado à sessão.' });
  }

  const ambiente = (p.ambient ?? {}) as Record<string, unknown>;
  linhas.push({ texto: 'Condições ambientais declaradas', titulo: true });
  const pares = Object.keys(ambiente)
    .sort()
    .map((k) => `${k}: ${valor(ambiente[k])}`);
  linhas.push({ texto: pares.length > 0 ? pares.join(' · ') : 'Não informadas.' });

  linhas.push({ texto: 'Pontos de medição', titulo: true });
  const pontos = (Array.isArray(p.points) ? p.points : []) as Array<Record<string, unknown>>;
  if (pontos.length === 0) linhas.push({ texto: 'Nenhum ponto de medição neste protocolo.' });
  for (const pt of pontos) {
    linhas.push({ texto: valor(pt.label), negrito: true, espacoAntes: 4 });
    linhas.push({
      texto:
        `Unidade: ${valor(pt.unit)} · Nominal: ${valor(pt.nominal)} · Tolerância declarada: ` +
        `−${valor(pt.tolerance_minus)} / +${valor(pt.tolerance_plus)} (${valor(pt.tolerance_mode)})`,
      recuo: 12,
    });
    const leituras = Array.isArray(pt.readings) ? (pt.readings as unknown[]).map(String).join('; ') : '—';
    linhas.push({
      texto: `Leituras (${valor(pt.readings_required)} exigidas): ${leituras} · revisão ${valor(pt.revision)}`,
      recuo: 12,
    });
  }

  const brutos = (Array.isArray(p.raw_data) ? p.raw_data : []) as Array<Record<string, unknown>>;
  linhas.push({ texto: 'Dados brutos preservados', titulo: true });
  if (brutos.length === 0) linhas.push({ texto: 'Nenhum.' });
  for (const b of brutos) {
    linhas.push({ texto: `${valor(b.file_name)} (${valor(b.content_type)}) — SHA-256 ${valor(b.sha256)}` });
  }

  if (typeof p.notice === 'string') {
    linhas.push({ texto: p.notice, tamanho: 9, espacoAntes: 8 });
  }
}

export function linhasDoDocumento(d: DocumentoParaPdf): LinhaPdf[] {
  const emitido = EMITIDO.has(d.status);
  const linhas: LinhaPdf[] = [
    { texto: d.organization_name, titulo: true, tamanho: 14 },
    { texto: d.type_label, negrito: true, tamanho: 12 },
    { texto: d.title ?? '', tamanho: 11 },
    {
      texto: emitido
        ? `Número ${d.number} · versão ${d.version}`
        : `Sem número (documento não emitido) · versão ${d.version}`,
      espacoAntes: 6,
    },
    { texto: `Situação: ${STATUS_LABELS[d.status] ?? d.status}` },
    {
      texto: `Emitido em: ${quando(d.issued_at)} · Validade: ${d.valid_until ? d.valid_until.slice(0, 10) : 'sem validade'}`,
    },
    {
      texto: `Parecer: ${d.verdict ? (VERDICT_LABELS[d.verdict as DocumentVerdict] ?? d.verdict) : 'não informado'}`,
    },
    { texto: `Equipamento: ${valor(d.asset_name)} · OS: ${valor(d.work_order_number)}` },
    { texto: `Responsável técnico: ${valor(d.technical_manager_name)}` },
  ];

  const instantaneo = d.payload[SESSION_SNAPSHOT_KEY] as Record<string, unknown> | undefined;
  if (instantaneo && instantaneo.schema === SESSION_SNAPSHOT_SCHEMA) {
    secaoDaSessao(instantaneo, linhas);
  }
  const outros = Object.keys(d.payload)
    .filter((k) => k !== SESSION_SNAPSHOT_KEY)
    .sort();
  if (!instantaneo || outros.length > 0) {
    linhas.push({ texto: 'Conteúdo', titulo: true });
    const chaves = outros;
    if (chaves.length === 0) linhas.push({ texto: 'Sem campos preenchidos.' });
    for (const k of chaves) linhas.push({ texto: `${k}: ${valor(d.payload[k])}` });
  }

  linhas.push({ texto: 'Assinaturas', titulo: true });
  if (d.signatures.length === 0) linhas.push({ texto: 'Nenhuma assinatura registrada.' });
  for (const a of d.signatures) {
    linhas.push({
      texto:
        `${a.signer_name} — ${a.method} — ${quando(a.signed_at)} — ` +
        (a.valid ? 'cobre o conteúdo atual' : 'NÃO cobre o conteúdo atual'),
    });
  }
  linhas.push({
    texto:
      'O sistema registra evidência de assinatura; não afirma validade jurídica. ' +
      'A integridade do documento é a do hash abaixo, não a deste arquivo.',
    tamanho: 8,
    espacoAntes: 8,
  });
  linhas.push({
    texto: `Hash do conteúdo (SHA-256): ${d.content_hash ?? 'ainda não consolidado'}`,
    tamanho: 8,
  });
  return linhas;
}

export function pdfDoDocumento(d: DocumentoParaPdf): Buffer {
  const emitido = EMITIDO.has(d.status);
  return gerarPdf(linhasDoDocumento(d), {
    titulo: `${d.type_label} ${d.number ?? '(não emitido)'}`,
    autor: d.organization_name,
    rodape: `${d.organization_name} · ${d.type_label} ${d.number ?? 'não emitido'} · v${d.version} · documento ${d.id}`,
    faixa: emitido
      ? null
      : `DOCUMENTO NÃO EMITIDO (${STATUS_LABELS[d.status] ?? d.status}) — SEM VALOR DE REGISTRO`,
  });
}

/** Nome de arquivo seguro para o cabeçalho de download. */
export function nomeDoArquivo(d: Pick<DocumentoParaPdf, 'number' | 'id' | 'version'>): string {
  const base = (d.number ?? `rascunho-${d.id.slice(0, 8)}`).replace(/[^A-Za-z0-9._-]/g, '-');
  return `${base}-v${d.version}.pdf`;
}
