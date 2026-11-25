/**
 * Aurora — o atendimento do contrato: parar, reativar, renovar (respostas do
 * Anderson de 24/11/2026).
 *
 *   D-4 "Quando o contrato vence ou é apertado o botão suspender atendimento ou
 *       bloquear atendimento, tudo para e fica somente consulta, ninguém abre
 *       nem fecha chamado nestes casos."
 *   D-7 "Se possuir renovação automática, renova o ciclo se ninguém bloquear ou
 *       suspender."
 *   D-3 hora de preventiva e de corretiva pela hora de início e de término da OS.
 *
 * A regra vale no servidor; aqui ficam os botões, o aviso e as consultas.
 */
import { useState } from 'react';
import { Ban, Clock, History, PauseCircle, PlayCircle, RefreshCw } from 'lucide-react';
import { Button, Dialog, Field, Input, Textarea, useToast } from '@aurora/ui';
import {
  contractDetail,
  contractsHoldService,
  contractsList,
  contractsReleaseService,
  contractsRenew,
  contractsRenewals,
  contractsTechnicalHours,
  type ContractRenewal,
  type ContractRow,
} from '@aurora/contracts';
import { ApiError, Can, hojeLocal, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { formatarData } from '../comercial/orcamentos';

const INVALIDA = [contractsList, contractDetail, contractsRenewals];

/** O contrato está parando o atendimento? (o servidor decide; isto é só o aviso da tela). */
export function motivoDoBloqueio(c: Pick<ContractRow, 'status' | 'ends_on' | 'service_hold'>): string | null {
  if (c.service_hold === 'blocked') return 'Atendimento bloqueado';
  if (c.service_hold === 'suspended' || c.status === 'suspended') return 'Atendimento suspenso';
  if (c.status === 'expired' || (c.status === 'active' && c.ends_on && c.ends_on < hojeLocal())) {
    return 'Contrato vencido';
  }
  return null;
}

/** Aviso dentro da linha do contrato quando o atendimento está parado. */
export function AvisoDeAtendimento({ contrato: c }: { contrato: ContractRow }) {
  const motivo = motivoDoBloqueio(c);
  if (!motivo) return null;
  return (
    <p role="status" className="mt-2 rounded-control bg-warn-soft px-3 py-2 text-sm text-warn-text">
      <strong>{motivo}</strong>
      {c.service_hold_at ? ` desde ${formatarData(c.service_hold_at.slice(0, 10))}` : ''}
      {c.service_hold_reason ? ` — ${c.service_hold_reason}` : ''}. Tudo para e fica somente consulta: ninguém
      abre, executa nem conclui chamado ou OS deste contrato
      {c.service_hold ? ', e ele não renova sozinho' : ''}.
    </p>
  );
}

/** Os botões do atendimento: suspender, bloquear, reativar, renovar, renovações, horas técnicas. */
export function AcoesDoAtendimento({ contrato: c }: { contrato: ContractRow }) {
  const [reter, setReter] = useState<'suspended' | 'blocked' | null>(null);
  const [reativar, setReativar] = useState(false);
  const [renovar, setRenovar] = useState(false);
  const [renovacoes, setRenovacoes] = useState(false);
  const [horas, setHoras] = useState(false);
  const vigente = c.status === 'active';
  const podeRenovar = (c.status === 'active' || c.status === 'expired') && Boolean(c.ends_on);
  return (
    <div className="flex flex-wrap gap-2" aria-label={`Atendimento de ${c.number}`}>
      <Can permission="contract.update">
        {vigente && !c.service_hold && (
          <>
            <Button size="sm" icon={<PauseCircle className="size-4" />} onClick={() => setReter('suspended')}>
              Suspender atendimento
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Ban className="size-4" />}
              onClick={() => setReter('blocked')}
            >
              Bloquear atendimento
            </Button>
          </>
        )}
        {c.service_hold && (
          <Button
            size="sm"
            variant="primary"
            icon={<PlayCircle className="size-4" />}
            onClick={() => setReativar(true)}
          >
            Reativar atendimento
          </Button>
        )}
        {podeRenovar && (
          <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => setRenovar(true)}>
            Renovar
          </Button>
        )}
      </Can>
      {(c.renewal_count ?? 0) > 0 && (
        <Button
          size="sm"
          variant="ghost"
          icon={<History className="size-4" />}
          onClick={() => setRenovacoes(true)}
        >
          Renovações ({c.renewal_count})
        </Button>
      )}
      {c.status !== 'draft' && (
        <Button size="sm" variant="ghost" icon={<Clock className="size-4" />} onClick={() => setHoras(true)}>
          Horas técnicas
        </Button>
      )}
      {reter && <DialogoRetencao contrato={c} tipo={reter} onFechar={() => setReter(null)} />}
      {reativar && <DialogoReativar contrato={c} onFechar={() => setReativar(false)} />}
      {renovar && <DialogoRenovar contrato={c} onFechar={() => setRenovar(false)} />}
      {renovacoes && <DialogoRenovacoes contrato={c} onFechar={() => setRenovacoes(false)} />}
      {horas && <DialogoHorasTecnicas contrato={c} onFechar={() => setHoras(false)} />}
    </div>
  );
}

function Erro({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <p role="alert" className="mt-2 rounded-control bg-bad-soft px-3 py-2 text-sm text-bad-text">
      {texto}
    </p>
  );
}

function DialogoRetencao({
  contrato: c,
  tipo,
  onFechar,
}: {
  contrato: ContractRow;
  tipo: 'suspended' | 'blocked';
  onFechar: () => void;
}) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const reter = useApiMutation(contractsHoldService, {
    invalidates: INVALIDA,
    onSuccess: () => {
      toast.success(
        tipo === 'blocked' ? `Atendimento de ${c.number} bloqueado` : `Atendimento de ${c.number} suspenso`
      );
      onFechar();
    },
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  const verbo = tipo === 'blocked' ? 'Bloquear' : 'Suspender';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      size="sm"
      title={`${verbo} o atendimento de ${c.number}?`}
      description="Tudo para e fica somente consulta: ninguém abre, executa nem conclui chamado ou OS deste contrato. Os planos não geram OS. Suspenso ou bloqueado, o contrato não renova sozinho."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant="danger"
            loading={reter.isPending}
            disabled={motivo.trim().length < 10}
            onClick={() =>
              reter.mutate({ params: { id: c.id }, body: { hold: tipo, reason: motivo.trim() } })
            }
          >
            {verbo}
          </Button>
        </>
      }
    >
      <Field label="Motivo" required hint="Ao menos 10 caracteres. Aparece para quem esbarrar no bloqueio.">
        <Textarea rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Field>
      <Erro texto={erro} />
    </Dialog>
  );
}

function DialogoReativar({ contrato: c, onFechar }: { contrato: ContractRow; onFechar: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const reativar = useApiMutation(contractsReleaseService, {
    invalidates: INVALIDA,
    onSuccess: () => {
      toast.success(`Atendimento de ${c.number} reativado`);
      onFechar();
    },
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      size="sm"
      title={`Reativar o atendimento de ${c.number}?`}
      description="Chamados e OS voltam a poder ser abertos e concluídos. Se o contrato estiver vencido, renove-o também."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant="primary"
            loading={reativar.isPending}
            onClick={() => reativar.mutate({ params: { id: c.id }, body: { reason: motivo.trim() || null } })}
          >
            Reativar
          </Button>
        </>
      }
    >
      <Field label="Observação (opcional)">
        <Textarea rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Field>
      <Erro texto={erro} />
    </Dialog>
  );
}

function DialogoRenovar({ contrato: c, onFechar }: { contrato: ContractRow; onFechar: () => void }) {
  const toast = useToast();
  const [fim, setFim] = useState('');
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const renovar = useApiMutation(contractsRenew, {
    invalidates: INVALIDA,
    onSuccess: (r: unknown) => {
      const x = r as { new_ends_on: string };
      toast.success(`${c.number} renovado até ${formatarData(x.new_ends_on)}`);
      onFechar();
    },
    onError: (e: ApiError) => setErro(e.problem.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      size="sm"
      title={`Renovar ${c.number}`}
      description={`Término atual: ${c.ends_on ? formatarData(c.ends_on) : '—'}. Sem nova data, renova pelo prazo original do contrato. A renovação fica no histórico.`}
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant="primary"
            loading={renovar.isPending}
            onClick={() =>
              renovar.mutate({
                params: { id: c.id },
                body: { newEndsOn: fim || null, note: nota.trim() || null },
              })
            }
          >
            Renovar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Novo término (opcional)" hint="Vazio = mesmo prazo do contrato original.">
          <Input
            type="date"
            min={c.ends_on ?? undefined}
            value={fim}
            onChange={(e) => setFim(e.target.value)}
          />
        </Field>
        <Field label="Observação (opcional)">
          <Textarea rows={2} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} />
        </Field>
      </div>
      <Erro texto={erro} />
    </Dialog>
  );
}

function DialogoRenovacoes({ contrato: c, onFechar }: { contrato: ContractRow; onFechar: () => void }) {
  const { data } = useApiQuery(contractsRenewals, { params: { id: c.id } }) as {
    data: { items: ContractRenewal[] } | undefined;
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={`Renovações de ${c.number}`}
      description="Cada renovação da vigência, automática ou manual, com o término anterior e o novo."
    >
      <table className="w-full text-left text-sm" aria-label="Renovações">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 pr-2 font-medium">#</th>
            <th className="py-1 pr-2 font-medium">De</th>
            <th className="py-1 pr-2 font-medium">Para</th>
            <th className="py-1 pr-2 font-medium">Como</th>
            <th className="py-1 font-medium">Quando / quem</th>
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((r) => (
            <tr key={r.id} className="border-t border-border-subtle">
              <td className="py-1.5 pr-2">{r.seq}</td>
              <td className="py-1.5 pr-2">{formatarData(r.previous_ends_on)}</td>
              <td className="py-1.5 pr-2">{formatarData(r.new_ends_on)}</td>
              <td className="py-1.5 pr-2">{r.mode === 'automatic' ? 'Automática' : 'Manual'}</td>
              <td className="py-1.5 text-muted">
                {formatarData(r.created_at.slice(0, 10))}
                {r.created_by_name ? ` · ${r.created_by_name}` : ''}
                {r.note ? ` · ${r.note}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

const ROTULO_GRUPO: Record<string, string> = {
  preventive: 'Preventiva',
  corrective: 'Corretiva',
  other: 'Outras naturezas',
};

export function formatarMinutos(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function DialogoHorasTecnicas({ contrato: c, onFechar }: { contrato: ContractRow; onFechar: () => void }) {
  const hoje = hojeLocal();
  const [de, setDe] = useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = useState(hoje);
  const { data, isLoading } = useApiQuery(
    contractsTechnicalHours,
    { params: { id: c.id }, query: { from: de, to: ate } },
    { enabled: Boolean(de && ate && de <= ate) }
  ) as {
    data:
      | {
          totals: Array<{ group: string; work_orders: number; minutes: number }>;
          without_hours: number;
          items: Array<{
            work_order_id: string;
            number: string | null;
            title: string;
            group: string;
            service_started_at: string;
            service_ended_at: string;
            minutes: number;
          }>;
        }
      | undefined;
    isLoading: boolean;
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      size="lg"
      title={`Horas técnicas — ${c.number}`}
      description="Pela hora de início e de término de cada OS do contrato. Só apuração: nenhuma tarifa ou valor é calculado."
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="De">
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </Field>
          <Field label="Até">
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </Field>
        </div>
        {isLoading || !data ? (
          <p className="text-sm text-muted">Carregando…</p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2" aria-label="Totais de horas técnicas">
              {data.totals.map((t) => (
                <div key={t.group} className="rounded-card border border-border-subtle p-3">
                  <dt className="text-xs text-muted">{ROTULO_GRUPO[t.group] ?? t.group}</dt>
                  <dd className="text-lg font-semibold text-text" data-numeric>
                    {formatarMinutos(t.minutes)}
                  </dd>
                  <dd className="text-xs text-muted">{t.work_orders} OS</dd>
                </div>
              ))}
            </dl>
            {data.without_hours > 0 && (
              <p className="text-xs text-muted">
                {data.without_hours} OS concluídas no período sem hora de início/término (anteriores à regra)
                — não entram na soma.
              </p>
            )}
            <table className="w-full text-left text-sm" aria-label="OS das horas técnicas">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 pr-2 font-medium">OS</th>
                  <th className="py-1 pr-2 font-medium">Natureza</th>
                  <th className="py-1 pr-2 font-medium">Início → término</th>
                  <th className="py-1 font-medium">Duração</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.work_order_id} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-2">{i.number ?? i.title}</td>
                    <td className="py-1.5 pr-2">{ROTULO_GRUPO[i.group] ?? i.group}</td>
                    <td className="py-1.5 pr-2 text-muted" data-numeric>
                      {new Date(i.service_started_at).toLocaleString('pt-BR')} →{' '}
                      {new Date(i.service_ended_at).toLocaleString('pt-BR')}
                    </td>
                    <td className="py-1.5" data-numeric>
                      {formatarMinutos(i.minutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Dialog>
  );
}
