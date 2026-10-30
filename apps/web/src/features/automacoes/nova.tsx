/**
 * Aurora — "Nova automação" (reunião 16/10/2026, Fase 10).
 *
 * Cinco modelos sobre o MESMO motor (§24): relatório agendado, lembrete,
 * tarefa, 5W2H e PDCA. A tela monta a regra agendada — periodicidade em
 * linguagem de gente, que vira cron — e, se pedido, simula e liga em seguida.
 *
 * E-mail: não há transporte configurado nesta instalação. A entrega vai para a
 * caixa de entrada e o e-mail fica NA FILA — a tela diz isso, sem fingir envio.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Dialog, Field, Input, Select, Textarea, cn, useToast } from '@aurora/ui';
import {
  automationActivate,
  automationSimulate,
  automationsCreate,
  automationsList,
  customersList,
  membersList,
  type Member,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { parametrosDoRecorte, type NivelDoRelatorio, type RelatorioAgendadoInicial } from './do-relatorio';

type Modelo = 'scheduled_report' | 'reminder' | 'parts_alert' | 'task' | '5w2h' | 'pdca';
type Periodo = 'daily' | 'weekly' | 'monthly';

const MODELOS: ReadonlyArray<{ key: Modelo; label: string; dica: string }> = [
  {
    key: 'scheduled_report',
    label: 'Relatório agendado',
    dica: 'Basic, Advanced ou Expert, na periodicidade escolhida',
  },
  { key: 'reminder', label: 'Lembrete', dica: 'Aviso para as pessoas escolhidas' },
  {
    key: 'parts_alert',
    label: 'Aviso: OS aguardando peça',
    dica: 'Avisa na hora, p.ex. o setor de compras, quando uma OS passa a aguardar peça',
  },
  { key: 'task', label: 'Tarefa', dica: 'Tarefa com responsável e prazo' },
  { key: '5w2h', label: '5W2H', dica: 'O quê, por quê, onde, quando, quem, como, quanto' },
  { key: 'pdca', label: 'PDCA', dica: 'Planejar → Executar → Checar → Agir' },
];

const DIAS_DA_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Mesma regra de `cronFromPeriodicity` (domínio): a tela não inventa outra. */
function cronDe(p: Periodo, hora: string, diaSemana: number, diaMes: number): string {
  const [h, m] = hora.split(':').map(Number);
  const hh = Number.isFinite(h) ? h : 8;
  const mm = Number.isFinite(m) ? m : 0;
  if (p === 'daily') return `${mm} ${hh} * * *`;
  if (p === 'weekly') return `${mm} ${hh} * * ${diaSemana}`;
  return `${mm} ${hh} ${diaMes} * *`;
}

export function BotaoNovaAutomacao() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAberto(true)}>
        Nova automação
      </Button>
      {aberto && <DialogoNovaAutomacao onFechar={() => setAberto(false)} />}
    </>
  );
}

/**
 * `inicial`: a automação nasce do diálogo de relatório ("Criar automação com estes filtros",
 * REL-15) — modelo de relatório agendado, com nível, indicadores, cliente, setor e filtros.
 */
export function DialogoNovaAutomacao({
  onFechar,
  inicial,
}: {
  onFechar: () => void;
  inicial?: RelatorioAgendadoInicial;
}) {
  const toast = useToast();
  const [modelo, setModelo] = useState<Modelo>('scheduled_report');
  const [nome, setNome] = useState(inicial?.nome ?? '');
  const [periodo, setPeriodo] = useState<Periodo>('weekly');
  const [hora, setHora] = useState('08:00');
  const [diaSemana, setDiaSemana] = useState(1);
  const [diaMes, setDiaMes] = useState(1);
  const [destinatarios, setDestinatarios] = useState<string[]>([]);
  const [tier, setTier] = useState<NivelDoRelatorio>(inicial?.tier ?? 'basic');
  const [dias, setDias] = useState('30');
  // "Últimos N dias" (o de sempre) ou o MÊS CIVIL anterior (PF-52).
  const [janela, setJanela] = useState<'dias' | 'mes_anterior'>('dias');
  const [cliente, setCliente] = useState(inicial?.cliente ?? '');
  // Recorte que veio do relatório e não tem campo próprio aqui: vai junto, e a tela o mostra.
  const [recorte, setRecorte] = useState(() => ({
    indicadores: inicial?.indicadores ?? [],
    setor: inicial?.setor ?? '',
    tipoDePlano: inicial?.tipoDePlano ?? '',
    categoria: inicial?.categoria ?? '',
    tipoDeManutencao: inicial?.tipoDeManutencao ?? '',
  }));
  const temRecorte =
    recorte.indicadores.length > 0 ||
    recorte.setor !== '' ||
    recorte.tipoDePlano !== '' ||
    recorte.categoria !== '' ||
    recorte.tipoDeManutencao !== '';
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [prazo, setPrazo] = useState('7');
  const [porque, setPorque] = useState('');
  const [onde, setOnde] = useState('');
  const [como, setComo] = useState('');
  const [quanto, setQuanto] = useState('');
  const [ligar, setLigar] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const { data: membros } = useApiQuery(membersList) as { data: { items: Member[] } | undefined };
  const { data: clientes } = useApiQuery(customersList) as {
    data: { items: { id: string; name: string }[] } | undefined;
  };
  const ativos = (membros?.items ?? []).filter((m) => m.status === 'active');
  const opcoes = { onError: (e: ApiError) => toast.error('Automação não criada', e.problem.message) };
  const criar = useApiMutation(automationsCreate, { invalidates: [automationsList], ...opcoes });
  const simular = useApiMutation(automationSimulate, opcoes);
  const ativar = useApiMutation(automationActivate, { invalidates: [automationsList], ...opcoes });

  const ehTarefa = modelo === 'task' || modelo === '5w2h' || modelo === 'pdca';

  function acao(): { kind: string; params: Record<string, unknown> } {
    if (modelo === 'scheduled_report') {
      return {
        kind: 'send_report',
        params: {
          recipients: destinatarios,
          ...parametrosDoRecorte({ tier, cliente, ...recorte }),
          ...(janela === 'mes_anterior' ? { periodo: 'mes_anterior' } : { periodDays: Number(dias) }),
        },
      };
    }
    if (modelo === 'reminder') {
      return { kind: 'reminder', params: { recipients: destinatarios, title: titulo, message: mensagem } };
    }
    if (modelo === 'parts_alert') {
      return {
        kind: 'reminder',
        params: {
          recipients: destinatarios,
          title: titulo.trim() || 'OS {{number}} aguardando peça',
          message: mensagem.trim() || 'A ordem de serviço parou por falta de peça. Verifique a compra.',
        },
      };
    }
    return {
      kind: 'create_task',
      params: {
        method: modelo,
        title: titulo,
        ownerMembershipId: responsavel,
        dueInDays: Number(prazo),
        ...(modelo === '5w2h'
          ? { why: porque, where: onde, how: como, ...(quanto ? { howMuch: quanto } : {}) }
          : {}),
      },
    };
  }

  async function salvar() {
    setSalvando(true);
    try {
      const r = (await criar.mutateAsync({
        body:
          modelo === 'parts_alert'
            ? {
                name: nome.trim(),
                // Gatilho por EVENTO: dispara quando uma OS passa a aguardar peça.
                triggerKind: 'event',
                triggerEvent: 'work_order.blocked',
                conditions: { field: 'wait_reason_key', op: 'eq', value: 'parts' },
                actions: [acao()],
              }
            : {
                name: nome.trim(),
                triggerKind: 'schedule',
                triggerCron: cronDe(periodo, hora, diaSemana, diaMes),
                triggerTimezone: 'America/Sao_Paulo',
                actions: [acao()],
              },
      })) as { id: string };
      if (ligar) {
        await simular.mutateAsync({ params: { id: r.id }, body: { days: 30 } });
        await ativar.mutateAsync({ params: { id: r.id } });
      }
      toast.success(ligar ? 'Automação criada e ligada' : 'Automação criada (desligada)');
      onFechar();
    } catch {
      // o toast de erro já saiu pelo onError
    } finally {
      setSalvando(false);
    }
  }

  const alternar = (id: string) =>
    setDestinatarios((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title="Nova automação"
      description="Escolha o modelo, a periodicidade e quem recebe. Horário de Brasília."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button variant="primary" loading={salvando} disabled={!nome.trim()} onClick={() => void salvar()}>
            Criar automação
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Modelo</legend>
          <div role="radiogroup" aria-label="Modelo" className="grid gap-2 sm:grid-cols-3">
            {MODELOS.map((m) => (
              <label
                key={m.key}
                className={cn(
                  'flex min-h-12 cursor-pointer flex-col gap-0.5 rounded-control border p-3 text-sm',
                  modelo === m.key ? 'border-accent bg-accent-soft' : 'border-border-subtle'
                )}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <input
                    type="radio"
                    name="modelo"
                    checked={modelo === m.key}
                    onChange={() => setModelo(m.key)}
                  />
                  {m.label}
                </span>
                <span className="text-xs text-muted">{m.dica}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Nome da automação">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={200} />
        </Field>

        {modelo !== 'parts_alert' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Periodicidade">
              <Select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
                <option value="daily">Diária</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
              </Select>
            </Field>
            {periodo === 'weekly' && (
              <Field label="Dia da semana">
                <Select value={String(diaSemana)} onChange={(e) => setDiaSemana(Number(e.target.value))}>
                  {DIAS_DA_SEMANA.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {periodo === 'monthly' && (
              <Field label="Dia do mês">
                <Select value={String(diaMes)} onChange={(e) => setDiaMes(Number(e.target.value))}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Horário">
              <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </Field>
          </div>
        )}

        {modelo === 'scheduled_report' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Modelo de relatório">
              <Select
                value={tier}
                onChange={(e) => {
                  setTier(e.target.value as NivelDoRelatorio);
                  // Os indicadores escolhidos eram do outro modelo.
                  setRecorte((r) => ({ ...r, indicadores: [] }));
                }}
              >
                <option value="basic">Basic</option>
                <option value="advanced">Advanced</option>
                <option value="expert">Expert</option>
              </Select>
            </Field>
            <Field
              label="Período do relatório"
              hint={
                janela === 'mes_anterior'
                  ? 'Do dia 1 ao último dia do mês anterior à execução, no fuso da organização.'
                  : undefined
              }
            >
              <Select value={janela} onChange={(e) => setJanela(e.target.value as 'dias' | 'mes_anterior')}>
                <option value="dias">Últimos dias até a execução</option>
                <option value="mes_anterior">Mês anterior (calendário)</option>
              </Select>
            </Field>
            {janela === 'dias' && (
              <Field label="Período (dias)">
                <Input
                  type="number"
                  min={1}
                  max={366}
                  value={dias}
                  onChange={(e) => setDias(e.target.value)}
                />
              </Field>
            )}
            <Field label="Cliente">
              <Select
                value={cliente}
                onChange={(e) => {
                  setCliente(e.target.value);
                  // Setor é sempre DE um cliente.
                  setRecorte((r) => ({ ...r, setor: '' }));
                }}
              >
                <option value="">Todos os do destinatário</option>
                {(clientes?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {modelo === 'scheduled_report' && temRecorte && (
          <div
            role="note"
            aria-label="Filtros vindos do relatório"
            className="flex flex-wrap items-center gap-2 rounded-control bg-accent-soft px-3 py-2 text-xs text-text"
          >
            <span>
              Filtros vindos do relatório:
              {recorte.indicadores.length > 0 && ` ${recorte.indicadores.length} indicador(es);`}
              {recorte.setor && ' setor;'}
              {recorte.tipoDeManutencao && ' tipo de manutenção;'}
              {recorte.tipoDePlano && ' tipo de plano;'}
              {recorte.categoria && ' família/tipo de equipamento;'} o período é o da automação.
            </span>
            <Button
              size="sm"
              onClick={() =>
                setRecorte({
                  indicadores: [],
                  setor: '',
                  tipoDePlano: '',
                  categoria: '',
                  tipoDeManutencao: '',
                })
              }
            >
              Limpar filtros
            </Button>
          </div>
        )}

        {(modelo === 'reminder' || modelo === 'parts_alert' || ehTarefa) && (
          <Field label={modelo === '5w2h' ? 'O quê (What)' : 'Título'}>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} />
          </Field>
        )}
        {(modelo === 'reminder' || modelo === 'parts_alert') && (
          <Field label="Mensagem">
            <Textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={2} />
          </Field>
        )}

        {(modelo === 'scheduled_report' || modelo === 'reminder' || modelo === 'parts_alert') && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">Destinatários</legend>
            <ul className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
              {ativos.map((m) => (
                <li key={m.membership_id}>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={destinatarios.includes(m.membership_id)}
                      onChange={() => alternar(m.membership_id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {ehTarefa && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={modelo === '5w2h' ? 'Quem (Who)' : 'Responsável'}>
              <Select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
                <option value="">Escolha…</option>
                {ativos.map((m) => (
                  <option key={m.membership_id} value={m.membership_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={modelo === '5w2h' ? 'Quando (prazo em dias)' : 'Prazo (dias)'}>
              <Input
                type="number"
                min={0}
                max={365}
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
              />
            </Field>
          </div>
        )}
        {modelo === '5w2h' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Por quê (Why)">
              <Input value={porque} onChange={(e) => setPorque(e.target.value)} />
            </Field>
            <Field label="Onde (Where)">
              <Input value={onde} onChange={(e) => setOnde(e.target.value)} />
            </Field>
            <Field label="Como (How)">
              <Input value={como} onChange={(e) => setComo(e.target.value)} />
            </Field>
            <Field label="Quanto (How much, R$)">
              <Input
                inputMode="decimal"
                placeholder="1500,00"
                value={quanto}
                onChange={(e) => setQuanto(e.target.value)}
              />
            </Field>
          </div>
        )}

        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={ligar} onChange={(e) => setLigar(e.target.checked)} />
          Ligar agora (simula a agenda e ativa). Desmarcado, fica desligada.
        </label>
        {modelo === 'parts_alert' && (
          <p role="note" className="rounded-control bg-surface-sunken px-3 py-2 text-xs text-muted">
            Dispara quando uma OS passa a <strong>aguardar peça</strong>. No título e na mensagem, use{' '}
            <code>{'{{number}}'}</code> para o número da OS.
          </p>
        )}
        {(modelo === 'scheduled_report' || modelo === 'reminder' || modelo === 'parts_alert') && (
          <p role="note" className="rounded-control bg-warn-soft px-3 py-2 text-xs text-warn-text">
            Entrega na caixa de entrada do sistema. E-mail: fica na fila — não há transporte de e-mail
            configurado nesta instalação.
          </p>
        )}
      </div>
    </Dialog>
  );
}
