/**
 * Aurora — o contrato no CADASTRO do cliente (pedidos do cliente, 19/10/2026).
 *
 *   CLI-05 — o modelo de relatório incluso no contrato: Basic, Advanced ou Expert;
 *   CLI-06 — a duração do contrato: início e fim da vigência.
 *
 * É dado simples de cadastro, e não o módulo de contratos (Comercial › Contratos):
 * não há valor, parcela nem cobertura aqui. A situação (vigente, vence em breve,
 * vencido) vem CALCULADA do servidor a cada leitura; a tela só a mostra. A trava
 * do relatório pelo modelo contratado não mora aqui.
 */
import { Field, Input, Select, StatusChip, type Tone } from '@aurora/ui';
import {
  CUSTOMER_REPORT_TIERS,
  type Customer,
  type CustomerContractStatus,
  type CustomerReportTier,
} from '@aurora/contracts';

export const ROTULO_DO_RELATORIO: Record<CustomerReportTier, string> = {
  basic: 'Basic',
  advanced: 'Advanced',
  expert: 'Expert',
};

export const SITUACAO_DO_CONTRATO: Record<CustomerContractStatus, { rotulo: string; tom: Tone }> = {
  active: { rotulo: 'Contrato vigente', tom: 'good' },
  expiring: { rotulo: 'Vence em até 30 dias', tom: 'warn' },
  expired: { rotulo: 'Contrato vencido', tom: 'bad' },
  not_started: { rotulo: 'Contrato a iniciar', tom: 'info' },
  not_informed: { rotulo: 'Vigência não informada', tom: 'neutral' },
};

/** "01/01/2026 a 31/12/2026", ou null sem as datas. */
export function periodoDoContrato(
  c: Pick<Customer, 'contract_starts_on' | 'contract_ends_on'>
): string | null {
  if (!c.contract_starts_on || !c.contract_ends_on) return null;
  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  return `${br(c.contract_starts_on)} a ${br(c.contract_ends_on)}`;
}

/** A vigência que o formulário vai mandar: `null` = serve; senão, o campo e a mensagem. */
export function problemaDaVigencia(inicio: string, fim: string): { campo: string; mensagem: string } | null {
  if (Boolean(inicio) !== Boolean(fim)) {
    return {
      campo: inicio ? 'contract_ends_on' : 'contract_starts_on',
      mensagem: 'Informe o início e o fim da vigência juntos (ou deixe os dois em branco).',
    };
  }
  if (inicio && fim && fim <= inicio) {
    return { campo: 'contract_ends_on', mensagem: 'O fim da vigência precisa ser depois do início.' };
  }
  return null;
}

/** O selo da situação da vigência, para a lista e a ficha. */
export function SeloDoContrato({ cliente, size = 'sm' }: { cliente: Customer; size?: 'sm' | 'md' }) {
  const s = SITUACAO_DO_CONTRATO[cliente.contract_status ?? 'not_informed'];
  const periodo = periodoDoContrato(cliente);
  return (
    <StatusChip tone={s.tom} size={size} hint={periodo ? `Vigência: ${periodo}` : undefined}>
      {s.rotulo}
    </StatusChip>
  );
}

export function CamposDoContrato({
  relatorio,
  inicio,
  fim,
  onRelatorio,
  onInicio,
  onFim,
  erroDe,
}: {
  relatorio: string;
  inicio: string;
  fim: string;
  onRelatorio: (v: string) => void;
  onInicio: (v: string) => void;
  onFim: (v: string) => void;
  erroDe: (campo: string) => string | null;
}) {
  return (
    <fieldset className="grid gap-4 rounded-card border border-border-subtle p-4 sm:grid-cols-3">
      <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">Contrato</legend>
      <Field
        label="Relatório incluso no contrato"
        error={erroDe('report_tier')}
        hint="O modelo de relatório que o contrato dá ao cliente."
      >
        <Select value={relatorio} onChange={(e) => onRelatorio(e.target.value)}>
          <option value="">Não informado</option>
          {CUSTOMER_REPORT_TIERS.map((t) => (
            <option key={t} value={t}>
              {ROTULO_DO_RELATORIO[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Início da vigência" error={erroDe('contract_starts_on')}>
        <Input type="date" value={inicio} onChange={(e) => onInicio(e.target.value)} />
      </Field>
      <Field
        label="Fim da vigência"
        error={erroDe('contract_ends_on')}
        hint="Depois do início. A situação (vigente, vence em breve, vencido) é calculada."
      >
        <Input type="date" value={fim} min={inicio || undefined} onChange={(e) => onFim(e.target.value)} />
      </Field>
    </fieldset>
  );
}
