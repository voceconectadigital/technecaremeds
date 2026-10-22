/**
 * Aurora — Qualidade: o lugar dos certificados (conversa com o cliente, 21/10/2026).
 *
 * "Já deixa o tópico de Qualidade, com o lugar para os certificados de calibração, teste de segurança
 * elétrica, qualificação e treinamento." Quatro abas, uma por tipo; cada certificado diz quem emitiu,
 * quando e até quando vale, e leva o arquivo (PDF ou imagem). Os VENCIDOS e os que vencem em 30 dias
 * abrem a lista: a pergunta de quem entra aqui é "o que vence?".
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Award, Download, FilePlus2, Paperclip, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonList,
  StatusChip,
  Tabs,
  Textarea,
  tabIds,
  useToast,
} from '@aurora/ui';
import {
  assetsList,
  customersList,
  qualityCreate,
  qualityDelete,
  qualityList,
  QUALITY_KIND_LABELS,
  type QualityRecordRow,
} from '@aurora/contracts';
import {
  ApiError,
  Can,
  lerSessaoGuardada,
  useApi,
  useApiMutation,
  useApiQuery,
  useUrlState,
} from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';

type Tipo = keyof typeof QUALITY_KIND_LABELS;
const TIPOS = Object.keys(QUALITY_KIND_LABELS) as Tipo[];
const MAX_MB = 10;

const ROTULO_SITUACAO = {
  valid: 'Vigente',
  expiring: 'Vence em breve',
  expired: 'Vencido',
  no_validity: 'Sem validade',
} as const;
const TOM_SITUACAO = { valid: 'good', expiring: 'warn', expired: 'bad', no_validity: 'neutral' } as const;

function dataBr(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** "Vence em 12 dias", "Venceu há 3 dias": a situação em linguagem de gente. */
export function frasePorVencimento(validUntil: string | null, hoje = new Date()): string {
  if (!validUntil) return 'Sem validade informada';
  const dias = Math.round(
    (Date.parse(`${validUntil.slice(0, 10)}T00:00:00Z`) -
      Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) /
      86_400_000
  );
  if (dias < 0) return `Venceu há ${-dias} ${-dias === 1 ? 'dia' : 'dias'} (${dataBr(validUntil)})`;
  if (dias === 0) return `Vence hoje (${dataBr(validUntil)})`;
  return `Vence em ${dias} ${dias === 1 ? 'dia' : 'dias'} (${dataBr(validUntil)})`;
}

export function QualidadePage() {
  const [aba, setAba] = useUrlState<string>('tipo', 'todos');
  const [novo, setNovo] = useState(false);
  const tipo = (TIPOS as string[]).includes(aba) ? (aba as Tipo) : null;

  const { data, isLoading, isError } = useApiQuery(qualityList, {
    query: tipo ? { kind: tipo } : {},
  }) as { data: { items: QualityRecordRow[] } | undefined; isLoading: boolean; isError: boolean };
  const itens = data?.items ?? [];
  const vencidos = itens.filter((i) => i.status === 'expired').length;
  const vencendo = itens.filter((i) => i.status === 'expiring').length;
  const abaAtual = tipo ?? 'todos';

  return (
    <AppShell
      title="Qualidade"
      subtitle="Certificados de calibração, segurança elétrica, qualificação e treinamento — com a validade à vista."
      actions={
        <Can permission="document.create">
          <Button variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => setNovo(true)}>
            Novo certificado
          </Button>
        </Can>
      }
    >
      <div className="flex flex-col gap-4">
        <Tabs
          idPrefix="qualidade"
          value={abaAtual}
          onChange={setAba}
          aria-label="Tipo de certificado"
          items={[
            { id: 'todos', label: 'Todos' },
            ...TIPOS.map((k) => ({ id: k, label: QUALITY_KIND_LABELS[k] })),
          ]}
        />
        <div
          role="tabpanel"
          id={tabIds('qualidade', abaAtual).painel}
          aria-labelledby={tabIds('qualidade', abaAtual).aba}
        >
          {(vencidos > 0 || vencendo > 0) && (
            <p
              role="status"
              className={`mb-3 rounded-control px-3 py-2 text-sm ${vencidos > 0 ? 'bg-bad-soft text-bad-text' : 'bg-warn-soft text-warn-text'}`}
            >
              {vencidos > 0 &&
                `${vencidos} ${vencidos === 1 ? 'certificado vencido' : 'certificados vencidos'}`}
              {vencidos > 0 && vencendo > 0 && ' · '}
              {vencendo > 0 && `${vencendo} ${vencendo === 1 ? 'vence' : 'vencem'} em até 30 dias`}
            </p>
          )}
          {isLoading ? (
            <SkeletonList rows={4} label="certificados" />
          ) : isError ? (
            <EmptyState
              icon={<Award className="size-5" />}
              title="Não conseguimos carregar agora"
              description="Confira a conexão e tente de novo."
            />
          ) : itens.length === 0 ? (
            <EmptyState
              icon={<Award className="size-5" />}
              title="Nenhum certificado ainda"
              description="Cadastre o primeiro: a validade passa a ser acompanhada aqui."
            />
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Certificados">
              {itens.map((r) => (
                <li key={r.id}>
                  <CartaoDoCertificado registro={r} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {novo && <DialogoNovoCertificado tipoInicial={tipo} onFechar={() => setNovo(false)} />}
    </AppShell>
  );
}

function useArquivos() {
  const api = useApi();
  const urlDe = (id: string) => `${api.urlFor(qualityList)}/${id}/file`;
  const cabecalhos = () => {
    const { token, organizationId } = lerSessaoGuardada();
    return {
      authorization: `Bearer ${token ?? ''}`,
      ...(organizationId ? { 'x-aurora-organization': organizationId } : {}),
    };
  };
  return {
    async subir(id: string, arquivo: File): Promise<void> {
      if (arquivo.size > MAX_MB * 1024 * 1024) throw new Error(`O arquivo passa de ${MAX_MB} MB.`);
      const r = await fetch(urlDe(id), {
        method: 'PUT',
        headers: {
          ...cabecalhos(),
          'content-type': arquivo.type,
          'x-aurora-file-name': encodeURIComponent(arquivo.name),
        },
        body: await arquivo.arrayBuffer(),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(msg?.message ?? `O envio falhou (${r.status}).`);
      }
    },
    async baixar(id: string, nome: string): Promise<void> {
      const r = await fetch(urlDe(id), { headers: cabecalhos() });
      if (!r.ok) throw new Error(`O download falhou (${r.status}).`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}

function CartaoDoCertificado({ registro: r }: { registro: QualityRecordRow }) {
  const toast = useToast();
  const arquivos = useArquivos();
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const excluir = useApiMutation(qualityDelete, {
    invalidates: [qualityList],
    onError: (e: ApiError) => toast.error('Não foi possível excluir', e.problem.message),
  });

  async function anexar(f: File) {
    setOcupado(true);
    try {
      await arquivos.subir(r.id, f);
      toast.success('Arquivo anexado');
      // O arquivo muda o cartão: recarrega a lista.
      await qc.invalidateQueries({ queryKey: [qualityList.operationId] });
    } catch (e) {
      toast.error('O arquivo não foi enviado', (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  async function baixar() {
    try {
      await arquivos.baixar(r.id, r.file_name ?? 'certificado');
    } catch (e) {
      toast.error('O download falhou', (e as Error).message);
    }
  }

  const sobre = [r.asset_name, r.customer_name, r.person_name].filter(Boolean).join(' · ');
  return (
    <Card>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-text">{r.title}</h3>
            <StatusChip tone="info" size="sm" withoutDot>
              {QUALITY_KIND_LABELS[r.kind]}
            </StatusChip>
            <StatusChip tone={TOM_SITUACAO[r.status]} size="sm">
              {ROTULO_SITUACAO[r.status]}
            </StatusChip>
          </div>
          {sobre && <p className="mt-1 text-sm text-muted">{sobre}</p>}
          <p className="mt-1 text-sm text-text">{frasePorVencimento(r.valid_until)}</p>
          <p className="mt-1 text-xs text-muted">
            Emitido em {dataBr(r.issued_at)}
            {r.issuer ? ` por ${r.issuer}` : ''}
            {r.certificate_number ? ` · nº ${r.certificate_number}` : ''}
          </p>
          {r.note && <p className="mt-2 text-sm whitespace-pre-wrap text-text">{r.note}</p>}
        </div>
        <div className="aurora-no-print flex flex-wrap items-center gap-2">
          {r.file_name ? (
            <Button size="sm" icon={<Download className="size-4" />} onClick={() => void baixar()}>
              Baixar arquivo
            </Button>
          ) : (
            <span className="text-xs text-subtle">Sem arquivo</span>
          )}
          <Can permission="document.create">
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-control border border-border px-3 text-sm font-medium text-text hover:bg-surface-sunken">
              <Paperclip aria-hidden="true" className="size-4" />
              {ocupado ? 'Enviando…' : r.file_name ? 'Trocar arquivo' : 'Anexar arquivo'}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={ocupado}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void anexar(f);
                  e.target.value = '';
                }}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Excluir ${r.title}`}
              icon={<Trash2 className="size-4" />}
              loading={excluir.isPending}
              onClick={() => {
                if (window.confirm(`Excluir o certificado "${r.title}"?`))
                  excluir.mutate({ params: { id: r.id } });
              }}
            />
          </Can>
        </div>
      </div>
    </Card>
  );
}

function DialogoNovoCertificado({
  tipoInicial,
  onFechar,
}: {
  tipoInicial: Tipo | null;
  onFechar: () => void;
}) {
  const toast = useToast();
  const arquivos = useArquivos();
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<Tipo>(tipoInicial ?? 'calibration');
  const [titulo, setTitulo] = useState('');
  const [cliente, setCliente] = useState('');
  const [ativo, setAtivo] = useState('');
  const [pessoa, setPessoa] = useState('');
  const [numero, setNumero] = useState('');
  const [emissor, setEmissor] = useState('');
  const [emitidoEm, setEmitidoEm] = useState('');
  const [validoAte, setValidoAte] = useState('');
  const [nota, setNota] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data: clientes } = useApiQuery(customersList) as {
    data: { items: { id: string; name: string }[] } | undefined;
  };
  const { data: equipamentos } = useApiQuery(
    assetsList,
    { query: { customer: cliente || undefined, limit: 500 } },
    { enabled: Boolean(cliente) }
  ) as { data: { items: { id: string; name: string; tag: string | null }[] } | undefined };

  const criar = useApiMutation(qualityCreate, {
    invalidates: [qualityList],
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  const treinamento = tipo === 'training';

  async function salvar() {
    setErro(null);
    if (!titulo.trim()) return setErro('Dê um título ao certificado.');
    if (!emitidoEm) return setErro('Informe a data de emissão.');
    if (treinamento && !pessoa.trim()) return setErro('Informe quem foi treinado.');
    if (!treinamento && !ativo && !cliente) return setErro('Escolha o equipamento ou o cliente.');
    setSalvando(true);
    try {
      const r = (await criar.mutateAsync({
        body: {
          kind: tipo,
          title: titulo.trim(),
          customer_id: cliente || null,
          asset_id: !treinamento && ativo ? ativo : null,
          person_name: treinamento ? pessoa.trim() : null,
          certificate_number: numero.trim() || null,
          issuer: emissor.trim() || null,
          issued_at: emitidoEm,
          valid_until: validoAte || null,
          note: nota.trim() || null,
        },
      })) as { id: string };
      if (arquivo) {
        try {
          await arquivos.subir(r.id, arquivo);
          // A lista já recarregou ao cadastrar, sem o arquivo: recarrega de novo agora que ele subiu.
          await qc.invalidateQueries({ queryKey: [qualityList.operationId] });
        } catch (e) {
          toast.error('O certificado foi cadastrado, mas o arquivo não subiu', (e as Error).message);
          onFechar();
          return;
        }
      }
      toast.success('Certificado cadastrado');
      onFechar();
    } catch {
      // A mensagem já está no formulário (onError).
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title="Novo certificado"
      description="PDF ou imagem de até 10 MB. A validade passa a ser acompanhada na lista."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button variant="primary" loading={salvando} onClick={() => void salvar()}>
            Cadastrar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
            {TIPOS.map((k) => (
              <option key={k} value={k}>
                {QUALITY_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Título">
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} />
        </Field>
        {treinamento ? (
          <Field label="Quem foi treinado">
            <Input value={pessoa} onChange={(e) => setPessoa(e.target.value)} maxLength={200} />
          </Field>
        ) : (
          <>
            <Field label="Cliente">
              <Select
                value={cliente}
                onChange={(e) => {
                  setCliente(e.target.value);
                  setAtivo('');
                }}
              >
                <option value="">Escolha…</option>
                {(clientes?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Equipamento" hint="Opcional: sem ele, o certificado é do cliente.">
              <Select value={ativo} onChange={(e) => setAtivo(e.target.value)} disabled={!cliente}>
                <option value="">Nenhum</option>
                {(equipamentos?.items ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.tag ? `${a.tag} · ` : ''}
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label="Número do certificado">
          <Input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Emitido por">
          <Input value={emissor} onChange={(e) => setEmissor(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Emitido em">
          <Input type="date" value={emitidoEm} onChange={(e) => setEmitidoEm(e.target.value)} />
        </Field>
        <Field label="Válido até" hint="Opcional.">
          <Input type="date" value={validoAte} onChange={(e) => setValidoAte(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observação" hint="Opcional.">
            <Textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={2000} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field
            label="Arquivo"
            hint="PDF, PNG, JPEG ou WebP, até 10 MB. Opcional agora: dá para anexar depois."
          >
            <input
              type="file"
              aria-label="Arquivo do certificado"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </Field>
        </div>
        {erro && (
          <p
            role="alert"
            className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text sm:col-span-2"
          >
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}
