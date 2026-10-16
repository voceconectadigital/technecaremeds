/**
 * Aurora — classificação do cliente: EAS × empresa corporativa (reunião 16/10/2026).
 *
 * Um campo de duas escolhas e o subtipo da escolha feita. O vocabulário espelha
 * `packages/domain/src/customer-kinds.ts`; o servidor confere a coerência.
 */
import { Field, Select, cn } from '@aurora/ui';

export type TipoDeCliente = 'eas' | 'corporate';

export const TIPOS_DE_CLIENTE: readonly { valor: TipoDeCliente; rotulo: string; dica: string }[] = [
  { valor: 'eas', rotulo: 'EAS', dica: 'Estabelecimento Assistencial de Saúde' },
  {
    valor: 'corporate',
    rotulo: 'Empresa corporativa',
    dica: 'Engenharia clínica, assistência técnica, prestadora',
  },
];

export const SUBTIPOS: Record<TipoDeCliente, readonly { valor: string; rotulo: string }[]> = {
  eas: [
    { valor: 'hospital', rotulo: 'Hospital' },
    { valor: 'clinica', rotulo: 'Clínica' },
    { valor: 'consultorio', rotulo: 'Consultório' },
    { valor: 'laboratorio', rotulo: 'Laboratório' },
    { valor: 'clinica_imagem', rotulo: 'Clínica de imagem' },
    { valor: 'home_care', rotulo: 'Home care' },
    { valor: 'outro_eas', rotulo: 'Outro EAS' },
  ],
  corporate: [
    { valor: 'engenharia_clinica', rotulo: 'Engenharia clínica' },
    { valor: 'assistencia_tecnica', rotulo: 'Assistência técnica' },
    { valor: 'prestadora_servico', rotulo: 'Prestadora de serviço' },
    { valor: 'outro_corporativo', rotulo: 'Outra empresa' },
  ],
};

/** "EAS · Hospital", "Empresa corporativa · Assistência técnica", ou null. */
export function rotuloDaClassificacao(c: { kind?: string | null; subtype?: string | null }): string | null {
  if (!c.kind) return null;
  const tipo = TIPOS_DE_CLIENTE.find((t) => t.valor === c.kind);
  const sub = c.subtype
    ? SUBTIPOS[c.kind as TipoDeCliente]?.find((s) => s.valor === c.subtype)?.rotulo
    : null;
  return [tipo?.rotulo ?? c.kind, sub].filter(Boolean).join(' · ');
}

export function CamposDeClassificacao({
  tipo,
  subtipo,
  onTipo,
  onSubtipo,
  erroSubtipo,
  bloquearTipo = false,
}: {
  tipo: TipoDeCliente;
  subtipo: string;
  onTipo: (t: TipoDeCliente) => void;
  onSubtipo: (s: string) => void;
  erroSubtipo?: string | null;
  bloquearTipo?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-text">Classificação</legend>
        <div role="radiogroup" aria-label="Classificação do cliente" className="grid gap-2 sm:grid-cols-2">
          {TIPOS_DE_CLIENTE.map((t) => (
            <label
              key={t.valor}
              className={cn(
                'flex min-h-12 cursor-pointer flex-col gap-0.5 rounded-control border p-3 text-sm',
                tipo === t.valor ? 'border-accent bg-accent-soft' : 'border-border-subtle',
                bloquearTipo && 'cursor-not-allowed opacity-60'
              )}
            >
              <span className="flex items-center gap-2 font-medium text-text">
                <input
                  type="radio"
                  name="tipo-de-cliente"
                  value={t.valor}
                  checked={tipo === t.valor}
                  disabled={bloquearTipo}
                  onChange={() => {
                    onTipo(t.valor);
                    onSubtipo('');
                  }}
                />
                {t.rotulo}
              </span>
              <span className="text-xs text-muted">{t.dica}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Subtipo" error={erroSubtipo ?? null}>
        <Select value={subtipo} onChange={(e) => onSubtipo(e.target.value)}>
          <option value="">Não informar</option>
          {SUBTIPOS[tipo].map((s) => (
            <option key={s.valor} value={s.valor}>
              {s.rotulo}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
