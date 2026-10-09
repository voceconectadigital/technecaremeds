/**
 * Aurora — procedimentos e checklists (o motor versionado que já existia).
 *
 * UM CONSTRUTOR, O MESMO MOTOR. Cada tipo de item oferecido aqui é um tipo
 * que o motor da 0024/0052 já executa no app de campo: texto, sim/não,
 * número com unidade, opção (conforme/não conforme é uma opção com a falha
 * declarada), foto, data e ponto de medição. Nada novo por baixo.
 *
 * O QUE ESTA TELA NÃO FAZ: decidir conformidade de medição. Nominal e
 * tolerâncias são DADO do procedimento; o veredito do ponto continua "não
 * avaliado" até a regra metrológica ser validada por especialista
 * (AURORA-METROLOGIA-FRONTEIRA). A tela diz isso onde a pessoa digita a
 * tolerância.
 *
 * PUBLICADA É IMUTÁVEL. Mudar um checklist em uso é criar a revisão seguinte;
 * as OS antigas continuam com a versão que usaram.
 */
import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Eye,
  FilePlus2,
  GitBranch,
  Info,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FilterChip,
  Input,
  Select,
  SkeletonList,
  StatusChip,
  Textarea,
  cn,
  useToast,
} from '@aurora/ui';
import {
  checklistTemplatesCreate,
  checklistTemplatesDetail,
  checklistTemplatesList,
  checklistTemplatesPublish,
  checklistTemplatesRevise,
  plansFormOptions,
  type TemplateItem,
  type TemplateRow,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery, usePermissions } from '@aurora/app-kit';
import { rotuloTipo } from '../painel/rotulos';

type TipoProc = '' | 'calibration' | 'electrical_safety' | 'qualification' | 'acceptance';

const TIPOS_PROC: Array<{ v: TipoProc; r: string }> = [
  { v: '', r: 'Preventiva / checklist operacional' },
  { v: 'calibration', r: 'Calibração' },
  { v: 'electrical_safety', r: 'TSE · Segurança elétrica' },
  { v: 'qualification', r: 'Qualificação' },
  { v: 'acceptance', r: 'Aceite' },
];

/** Tipos de campo da tela → tipo de item do motor. */
type Campo =
  'texto' | 'observacao' | 'simnao' | 'numero' | 'conformidade' | 'opcoes' | 'medicao' | 'foto' | 'data';
const CAMPOS: Array<{ v: Campo; r: string }> = [
  { v: 'texto', r: 'Texto / alfanumérico' },
  { v: 'simnao', r: 'Pergunta (sim / não)' },
  { v: 'conformidade', r: 'Conforme / não conforme' },
  { v: 'numero', r: 'Numérico (com unidade)' },
  { v: 'medicao', r: 'Medição (nominal ± tolerância)' },
  { v: 'opcoes', r: 'Escolha entre opções' },
  { v: 'observacao', r: 'Observação (opcional)' },
  { v: 'foto', r: 'Foto' },
  { v: 'data', r: 'Data' },
];

interface Linha {
  campo: Campo;
  label: string;
  required: boolean;
  unit: string;
  options: string;
  nominal: string;
  tolMenos: string;
  tolMais: string;
  modo: 'absolute' | 'percent';
  leituras: string;
}

const LINHA_VAZIA = (campo: Campo = 'texto'): Linha => ({
  campo,
  label: '',
  required: campo !== 'observacao',
  unit: '',
  options: '',
  nominal: '',
  tolMenos: '',
  tolMais: '',
  modo: 'absolute',
  leituras: '1',
});

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(',', '.')));

function paraItem(l: Linha): TemplateItem {
  const base = { label: l.label.trim(), required: l.required };
  switch (l.campo) {
    case 'texto':
      return { ...base, kind: 'text' };
    case 'observacao':
      return { ...base, kind: 'text', required: false };
    case 'simnao':
      return { ...base, kind: 'boolean' };
    case 'numero':
      return { ...base, kind: 'number', unit: l.unit.trim() || null };
    case 'conformidade':
      return {
        ...base,
        kind: 'option',
        options: ['Conforme', 'Não conforme', 'Não se aplica'],
        failing_options: ['Não conforme'],
      };
    case 'opcoes':
      return {
        ...base,
        kind: 'option',
        options: l.options
          .split(/[\n;]/)
          .map((o) => o.trim())
          .filter(Boolean),
      };
    case 'medicao': {
      const temTol = num(l.tolMenos) !== null || num(l.tolMais) !== null;
      return {
        ...base,
        kind: 'measurement',
        unit: l.unit.trim() || null,
        nominal_value: num(l.nominal),
        tolerance_minus: num(l.tolMenos),
        tolerance_plus: num(l.tolMais),
        tolerance_mode: temTol ? l.modo : null,
        readings_required: Math.max(1, Number(l.leituras) || 1),
      };
    }
    case 'foto':
      return { ...base, kind: 'photo' };
    case 'data':
      return { ...base, kind: 'date' };
  }
}

/** Do item gravado de volta para a linha do construtor (revisão). */
function deItem(i: {
  kind: string;
  label: string;
  required: boolean;
  options: string[];
  failing_options: string[];
  unit: string | null;
  nominal_value: number | null;
  tolerance_minus: number | null;
  tolerance_plus: number | null;
  tolerance_mode: string | null;
  readings_required: number | null;
}): Linha {
  const l = LINHA_VAZIA();
  l.label = i.label;
  l.required = i.required;
  l.unit = i.unit ?? '';
  if (i.kind === 'text') l.campo = i.required ? 'texto' : 'observacao';
  else if (i.kind === 'boolean') l.campo = 'simnao';
  else if (i.kind === 'number') l.campo = 'numero';
  else if (
    i.kind === 'option' &&
    i.options.includes('Conforme') &&
    i.failing_options.includes('Não conforme')
  )
    l.campo = 'conformidade';
  else if (i.kind === 'option' || i.kind === 'multi_option') {
    l.campo = 'opcoes';
    l.options = i.options.join('; ');
  } else if (i.kind === 'measurement') {
    l.campo = 'medicao';
    l.nominal = i.nominal_value?.toString() ?? '';
    l.tolMenos = i.tolerance_minus?.toString() ?? '';
    l.tolMais = i.tolerance_plus?.toString() ?? '';
    l.modo = i.tolerance_mode === 'percent' ? 'percent' : 'absolute';
    l.leituras = String(i.readings_required ?? 1);
  } else if (i.kind === 'photo') l.campo = 'foto';
  else if (i.kind === 'date') l.campo = 'data';
  return l;
}

/* -------------------------------------------------------------------------- */

export function ProcedimentosAba() {
  const { can } = usePermissions();
  const [filtro, setFiltro] = useState<string>('');
  const [construindo, setConstruindo] = useState<{ base?: TemplateRow } | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);

  const { data, isLoading } = useApiQuery(checklistTemplatesList, undefined, {
    enabled: can('procedure.read'),
  }) as {
    data: { items: TemplateRow[] } | undefined;
    isLoading: boolean;
  };
  const itens = (data?.items ?? []).filter(
    (t) => !filtro || (filtro === 'none' ? t.procedure_kind === null : t.procedure_kind === filtro)
  );

  if (!can('procedure.read')) {
    return (
      <Card>
        <EmptyState
          icon={<ClipboardList className="size-5" />}
          title="Sem acesso aos procedimentos"
          description="O seu papel não inclui a leitura de checklists."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de procedimento">
          {[
            { v: '', r: 'Todos' },
            { v: 'none', r: 'Preventiva' },
            ...TIPOS_PROC.filter((t) => t.v).map((t) => ({ v: t.v, r: rotuloTipo(t.v) })),
          ].map((t) => (
            <FilterChip key={t.v} active={filtro === t.v} onClick={() => setFiltro(t.v)}>
              {t.r}
            </FilterChip>
          ))}
        </div>
        <Can permission="procedure.create">
          <Button
            variant="primary"
            icon={<FilePlus2 className="size-4" />}
            onClick={() => setConstruindo({})}
          >
            Novo checklist
          </Button>
        </Can>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-3">
            <SkeletonList rows={4} label="procedimentos" />
          </div>
        ) : itens.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="Nenhum checklist ainda"
            description="O checklist é o que o técnico preenche em cada atividade do plano — no app de campo, mesmo sem rede."
          />
        ) : (
          <ul>
            {itens.map((t, i) => (
              <li
                key={t.id}
                className={cn('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-border-subtle')}
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-card bg-accent-soft text-accent-text"
                  aria-hidden="true"
                >
                  <ClipboardList className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">{t.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {rotuloTipo(t.procedure_kind ?? 'preventive')} · {t.item_count} itens
                    {t.published_version ? ` · publicada v${t.published_version}` : ''}
                  </span>
                </span>
                {t.status === 'draft' ? (
                  <StatusChip size="sm" tone="warn">
                    Rascunho v{t.version}
                  </StatusChip>
                ) : (
                  <StatusChip size="sm" tone="good">
                    v{t.version}
                  </StatusChip>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Eye className="size-4" />}
                  onClick={() => setVendo(t.id)}
                >
                  Ver
                </Button>
                <Can permission="procedure.update">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<GitBranch className="size-4" />}
                    onClick={() => setConstruindo({ base: t })}
                    disabled={t.status === 'draft'}
                  >
                    Revisar
                  </Button>
                </Can>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConstrutorDialog estado={construindo} onClose={() => setConstruindo(null)} />
      <DetalheDialog id={vendo} onClose={() => setVendo(null)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ConstrutorDialog({
  estado,
  onClose,
}: {
  estado: { base?: TemplateRow } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const { can } = usePermissions();
  const aberto = estado !== null;
  const base = estado?.base;
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tipo, setTipo] = useState<TipoProc>('');
  const [linhas, setLinhas] = useState<Linha[]>([LINHA_VAZIA()]);
  const [erro, setErro] = useState<string | null>(null);
  const [iniciado, setIniciado] = useState<string | null>(null);

  const { data: detalheBase } = useApiQuery(
    checklistTemplatesDetail,
    { params: { id: base?.id ?? '' } },
    { enabled: aberto && Boolean(base) }
  ) as { data: { items: Parameters<typeof deItem>[0][] } | undefined };

  const chave = aberto ? (base?.id ?? 'novo') : null;
  if (chave !== iniciado) {
    setIniciado(chave);
    setTitulo(base?.title ?? '');
    setDescricao(base?.description ?? '');
    setTipo((base?.procedure_kind ?? '') as TipoProc);
    setLinhas([LINHA_VAZIA()]);
    setErro(null);
  }
  // A revisão começa dos itens da versão atual, quando eles chegam.
  if (base && detalheBase && linhas.length === 1 && linhas[0]!.label === '' && detalheBase.items.length > 0) {
    setLinhas(detalheBase.items.map(deItem));
  }

  const invalida = [checklistTemplatesList, checklistTemplatesDetail, plansFormOptions];
  const aoErrar = (e: ApiError) => setErro(e.problem.message);
  const criar = useApiMutation(checklistTemplatesCreate, { invalidates: invalida, onError: aoErrar });
  const revisar = useApiMutation(checklistTemplatesRevise, { invalidates: invalida, onError: aoErrar });

  const mudar = (i: number, p: Partial<Linha>) =>
    setLinhas(linhas.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= linhas.length) return;
    const n = [...linhas];
    [n[i], n[j]] = [n[j]!, n[i]!];
    setLinhas(n);
  };

  async function salvar(publicar: boolean) {
    setErro(null);
    if (titulo.trim().length < 3) return setErro('Dê um título ao checklist (3+ letras).');
    const validas = linhas.filter((l) => l.label.trim());
    if (validas.length === 0) return setErro('Inclua ao menos um item com texto.');
    for (const l of validas) {
      if (l.campo === 'medicao' && !l.unit.trim())
        return setErro(`"${l.label}": medição precisa de unidade.`);
      if (l.campo === 'opcoes' && paraItem(l).options!.length < 2)
        return setErro(`"${l.label}": informe ao menos duas opções.`);
    }
    const items = validas.map(paraItem);
    try {
      if (base) {
        await revisar.mutateAsync({
          params: { id: base.id },
          body: {
            title: titulo.trim(),
            description: descricao.trim() || undefined,
            items,
            publish: publicar,
          },
        });
        toast.success(
          'Revisão criada',
          publicar ? 'A nova versão já vale para as próximas atividades.' : 'Rascunho salvo.'
        );
      } else {
        await criar.mutateAsync({
          body: {
            title: titulo.trim(),
            description: descricao.trim() || undefined,
            procedure_kind: tipo || null,
            items,
            publish: publicar,
          },
        });
        toast.success(
          'Checklist criado',
          publicar ? 'Publicado — já pode ser usado em planos.' : 'Rascunho salvo.'
        );
      }
      onClose();
    } catch {
      // mensagem no formulário
    }
  }

  const salvando = criar.isPending || revisar.isPending;
  const temMedicao = linhas.some((l) => l.campo === 'medicao');

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={base ? `Nova revisão — ${base.title}` : 'Novo checklist / procedimento'}
      description={
        base
          ? 'A versão publicada continua valendo para as OS que já a usaram; esta será a seguinte.'
          : 'O que o técnico preenche em cada atividade. Publicado, fica imutável.'
      }
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button loading={salvando} onClick={() => void salvar(false)}>
            Salvar rascunho
          </Button>
          {can('procedure.publish') && (
            <Button variant="primary" loading={salvando} onClick={() => void salvar(true)}>
              Salvar e publicar
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título" required className="sm:col-span-2">
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Preventiva de monitor multiparamétrico"
            />
          </Field>
          <Field label="Tipo de procedimento" hint={base ? 'O tipo não muda entre versões.' : undefined}>
            <Select
              value={tipo}
              disabled={Boolean(base)}
              onChange={(e) => setTipo(e.target.value as TipoProc)}
            >
              {TIPOS_PROC.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Descrição">
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" />
          </Field>
        </div>

        {temMedicao && (
          <p className="flex gap-2 rounded-control bg-info-soft px-3 py-2 text-xs text-info-text">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            Nominal e tolerâncias ficam registrados como dado do procedimento. A conformidade da medição NÃO é
            calculada automaticamente — critério, incerteza e arredondamento dependem de validação
            metrológica.
          </p>
        )}

        <ol className="flex flex-col gap-2">
          {linhas.map((l, i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-card border border-card-border bg-surface-subtle p-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label={`Texto do item ${i + 1}`}
                  value={l.label}
                  onChange={(e) => mudar(i, { label: e.target.value })}
                  placeholder="Ex.: Alarmes sonoros funcionam?"
                  className="flex-1"
                />
                <Select
                  aria-label={`Tipo do item ${i + 1}`}
                  value={l.campo}
                  onChange={(e) => {
                    const campo = e.target.value as Campo;
                    mudar(i, { campo, required: campo !== 'observacao' });
                  }}
                  className="sm:w-60"
                >
                  {CAMPOS.map((c) => (
                    <option key={c.v} value={c.v}>
                      {c.r}
                    </option>
                  ))}
                </Select>
              </div>
              {(l.campo === 'numero' || l.campo === 'medicao') && (
                <div className="flex flex-wrap gap-2">
                  <Input
                    aria-label="Unidade"
                    value={l.unit}
                    onChange={(e) => mudar(i, { unit: e.target.value })}
                    placeholder="Unidade (ex.: mmHg)"
                    className="w-36"
                  />
                  {l.campo === 'medicao' && (
                    <>
                      <Input
                        aria-label="Valor nominal"
                        value={l.nominal}
                        onChange={(e) => mudar(i, { nominal: e.target.value })}
                        placeholder="Nominal"
                        inputMode="decimal"
                        className="w-28"
                      />
                      <Input
                        aria-label="Tolerância para menos"
                        value={l.tolMenos}
                        onChange={(e) => mudar(i, { tolMenos: e.target.value })}
                        placeholder="− tol."
                        inputMode="decimal"
                        className="w-24"
                      />
                      <Input
                        aria-label="Tolerância para mais"
                        value={l.tolMais}
                        onChange={(e) => mudar(i, { tolMais: e.target.value })}
                        placeholder="+ tol."
                        inputMode="decimal"
                        className="w-24"
                      />
                      <Select
                        aria-label="Modo da tolerância"
                        value={l.modo}
                        onChange={(e) => mudar(i, { modo: e.target.value as Linha['modo'] })}
                        className="w-32"
                      >
                        <option value="absolute">absoluta</option>
                        <option value="percent">percentual</option>
                      </Select>
                      <Input
                        aria-label="Leituras exigidas"
                        value={l.leituras}
                        onChange={(e) => mudar(i, { leituras: e.target.value })}
                        inputMode="numeric"
                        className="w-24"
                        placeholder="leituras"
                      />
                    </>
                  )}
                </div>
              )}
              {l.campo === 'opcoes' && (
                <Textarea
                  aria-label="Opções"
                  rows={2}
                  value={l.options}
                  onChange={(e) => mudar(i, { options: e.target.value })}
                  placeholder="Uma opção por linha (ou separadas por ;)"
                />
              )}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={l.required}
                    disabled={l.campo === 'observacao'}
                    onChange={(e) => mudar(i, { required: e.target.checked })}
                  />
                  Obrigatório
                </label>
                <span className="flex gap-1">
                  <IconeBotao rotulo="Subir" onClick={() => mover(i, -1)} disabled={i === 0}>
                    <ArrowUp className="size-4" />
                  </IconeBotao>
                  <IconeBotao rotulo="Descer" onClick={() => mover(i, 1)} disabled={i === linhas.length - 1}>
                    <ArrowDown className="size-4" />
                  </IconeBotao>
                  <IconeBotao
                    rotulo="Remover"
                    onClick={() =>
                      setLinhas(linhas.length === 1 ? [LINHA_VAZIA()] : linhas.filter((_, k) => k !== i))
                    }
                  >
                    <Trash2 className="size-4" />
                  </IconeBotao>
                </span>
              </div>
            </li>
          ))}
        </ol>
        <Button icon={<Plus className="size-4" />} onClick={() => setLinhas([...linhas, LINHA_VAZIA()])}>
          Adicionar item
        </Button>

        {erro && (
          <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function IconeBotao({
  rotulo,
  onClick,
  disabled,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-control text-subtle hover:bg-surface-hover hover:text-text disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

const ROTULO_KIND: Record<string, string> = {
  text: 'Texto',
  number: 'Numérico',
  boolean: 'Sim / não',
  option: 'Opção',
  multi_option: 'Múltipla escolha',
  photo: 'Foto',
  date: 'Data',
  measurement: 'Medição',
};

function DetalheDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const { data } = useApiQuery(
    checklistTemplatesDetail,
    { params: { id: id ?? '' } },
    { enabled: Boolean(id) }
  ) as {
    data:
      | {
          template: TemplateRow;
          items: Array<{
            id: string;
            kind: string;
            label: string;
            required: boolean;
            options: string[];
            unit: string | null;
            nominal_value: number | null;
            tolerance_minus: number | null;
            tolerance_plus: number | null;
            tolerance_mode: string | null;
            readings_required: number | null;
          }>;
          versions: Array<{ id: string; version: number; status: string }>;
        }
      | undefined;
  };
  const publicar = useApiMutation(checklistTemplatesPublish, {
    invalidates: [checklistTemplatesList, checklistTemplatesDetail, plansFormOptions],
    onSuccess: () => toast.success('Checklist publicado'),
    onError: (e: ApiError) => toast.error('Não foi possível publicar', e.problem.message),
  });

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={data?.template.title ?? 'Checklist'}
      description={
        data
          ? `${rotuloTipo(data.template.procedure_kind ?? 'preventive')} · versão ${data.template.version}`
          : 'Carregando'
      }
      footer={
        <>
          {data?.template.status === 'draft' && (
            <Can permission="procedure.publish">
              <Button
                variant="primary"
                loading={publicar.isPending}
                onClick={() => publicar.mutate({ params: { id: data.template.id } })}
              >
                Publicar esta versão
              </Button>
            </Can>
          )}
          <Button onClick={onClose}>Fechar</Button>
        </>
      }
    >
      {!data ? (
        <SkeletonList rows={4} label="itens" />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {data.versions.map((v) => (
              <StatusChip
                key={v.id}
                size="sm"
                tone={v.status === 'published' ? 'good' : v.status === 'draft' ? 'warn' : 'neutral'}
              >
                v{v.version} ·{' '}
                {v.status === 'published' ? 'publicada' : v.status === 'draft' ? 'rascunho' : 'arquivada'}
              </StatusChip>
            ))}
          </div>
          <ol className="flex flex-col divide-y divide-border-subtle rounded-card border border-border-subtle">
            {data.items.map((it, n) => (
              <li key={it.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                <span className="w-5 shrink-0 text-right text-xs text-subtle tabular-nums">{n + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-text">
                    {it.label}
                    {!it.required && <span className="ml-1 text-xs text-subtle">(opcional)</span>}
                  </span>
                  <span className="block text-xs text-muted">
                    {ROTULO_KIND[it.kind] ?? it.kind}
                    {it.unit ? ` · ${it.unit}` : ''}
                    {it.kind === 'option' && it.options.length > 0 ? ` · ${it.options.join(' / ')}` : ''}
                    {it.kind === 'measurement'
                      ? ` · nominal ${it.nominal_value ?? '—'}${
                          it.tolerance_minus !== null || it.tolerance_plus !== null
                            ? ` (−${it.tolerance_minus ?? 0} / +${it.tolerance_plus ?? 0}${it.tolerance_mode === 'percent' ? ' %' : ''})`
                            : ''
                        } · ${it.readings_required ?? 1} leitura(s)`
                      : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Dialog>
  );
}
