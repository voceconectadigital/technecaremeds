/**
 * Aurora — estoque (SPEC v0.2 §15 · EPIC-015).
 *
 * A PRIMEIRA PERGUNTA DO DIA É "o que está acabando?", e por isso ela é a
 * primeira aba — não um relatório que alguém precisa lembrar de rodar.
 *
 * Na referência auditada, "abaixo do mínimo" era um relatório. Um relatório é
 * uma pergunta que só é feita por quem lembra de fazê-la, e o custo aparece
 * como a peça que faltou no dia em que o ventilador parou.
 *
 * TRÊS NÚMEROS, E A DIFERENÇA ENTRE ELES É O PRODUTO
 *
 * `em mãos` é o que está na prateleira. `reservado` é o que já tem dono — uma
 * OS marcada para amanhã. `disponível` é a subtração, e vem do banco. Uma tela
 * que mostrasse só "em mãos" faria duas ordens reservarem a última peça, e o
 * segundo técnico descobriria isso na frente do equipamento.
 *
 * O EXTRATO ABRE EM GAVETA, e não em página própria: a pergunta "por que este
 * saldo está assim?" nasce olhando a linha, e tirar a pessoa da lista para
 * respondê-la a obriga a voltar e reencontrar onde estava.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Package, PackageSearch, Search } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  SkeletonList,
  StatusChip,
  Tabs,
  Textarea,
  cn,
  tabIds,
  useToast,
} from '@aurora/ui';
import {
  inventoryAdjust,
  inventoryBalances,
  inventoryLedger,
  type StockBalance,
  type StockMovement,
} from '@aurora/contracts';
import { ApiError, Can, useApiMutation, useApiQuery, useUrlState } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { ErrorScreen } from '../../shell/error-boundary';
import { formatarDataRelativa } from '../../routes/hoje';

const ABAS = [
  { id: 'faltando', label: 'Abaixo do mínimo' },
  { id: 'tudo', label: 'Todos os saldos' },
] as const;

export function EstoquePage() {
  const [aba, setAba] = useUrlState<string>('aba', 'faltando');
  const [busca, setBusca] = useState('');
  const [vendo, setVendo] = useState<StockBalance | null>(null);

  const { data, isLoading, isError, error } = useApiQuery(inventoryBalances, {
    query: aba === 'faltando' ? { below_minimum: 'true' } : {},
  }) as {
    data: { items: StockBalance[] } | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };

  // O contador da aba "abaixo do mínimo" precisa ser verdadeiro mesmo quando a
  // pessoa está na outra aba — senão o número só aparece depois de clicar, que
  // é tarde demais para servir de aviso.
  const { data: faltando } = useApiQuery(inventoryBalances, {
    query: { below_minimum: 'true' },
  }) as { data: { items: StockBalance[] } | undefined };

  const itens = useMemo(() => data?.items ?? [], [data]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return itens;
    return itens.filter(
      (b) =>
        b.item_name.toLowerCase().includes(termo) ||
        b.sku.toLowerCase().includes(termo) ||
        b.warehouse_name.toLowerCase().includes(termo)
    );
  }, [itens, busca]);

  if (isError) return <ErrorScreen error={error} />;

  const abas = ABAS.map((a) => ({
    ...a,
    count: a.id === 'faltando' ? (faltando?.items.length ?? 0) : undefined,
  }));

  return (
    <AppShell
      title="Estoque"
      subtitle="Saldo por almoxarifado, e o que precisa ser comprado antes de faltar."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            aria-label="Recorte do estoque"
            idPrefix="estoque"
            items={abas}
            value={aba}
            onChange={setAba}
          />
          <div className="relative sm:w-72">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle"
            />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar por item, código ou almoxarifado"
              aria-label="Filtrar saldos"
              className="h-8 w-full rounded-control border border-border-strong bg-surface pr-3 pl-8 text-sm text-text placeholder:text-subtle"
            />
          </div>
        </div>

        <div role="tabpanel" id={tabIds('estoque', aba).painel} aria-labelledby={tabIds('estoque', aba).aba}>
          <Card>
            {isLoading ? (
              <div className="p-3">
                <SkeletonList rows={8} label="saldos" />
              </div>
            ) : filtrados.length === 0 ? (
              <EmptyState
                icon={
                  aba === 'faltando' ? <Package className="size-5" /> : <PackageSearch className="size-5" />
                }
                title={
                  itens.length === 0
                    ? aba === 'faltando'
                      ? 'Nada abaixo do mínimo'
                      : 'Nenhum saldo registrado'
                    : 'Nenhum item com esse texto'
                }
                description={
                  itens.length === 0 && aba === 'faltando'
                    ? 'Todo item com mínimo definido está acima dele. Os que não têm mínimo não aparecem aqui — defina o mínimo para serem vigiados.'
                    : undefined
                }
                filtered={itens.length > 0}
              />
            ) : (
              <ul>
                {filtrados.map((b, i) => (
                  <li key={`${b.item_id}-${b.warehouse_id}`}>
                    <button
                      type="button"
                      onClick={() => setVendo(b)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover',
                        i > 0 && 'border-t border-border-subtle'
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base text-text">{b.item_name}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted" data-numeric>
                          {b.sku} · {b.warehouse_name}
                        </span>
                      </span>

                      <Quantidades saldo={b} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <p className="text-xs text-subtle" data-numeric>
          {filtrados.length === itens.length
            ? `${itens.length} ${itens.length === 1 ? 'saldo' : 'saldos'}`
            : `${filtrados.length} de ${itens.length}`}
        </p>
      </div>

      {vendo && <GavetaDoItem saldo={vendo} onFechar={() => setVendo(null)} />}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Os três números, com o reservado só quando existe.
 *
 * Mostrar "reservado: 0" em toda linha é ruído que esconde as linhas em que o
 * número não é zero — e são exatamente essas que mudam a decisão de quem está
 * separando peça.
 */
function Quantidades({ saldo }: { saldo: StockBalance }) {
  const emMaos = Number(saldo.on_hand);
  const reservado = Number(saldo.reserved);
  const disponivel = Number(saldo.available);
  const minimo = Number(saldo.min_qty);
  const abaixo = minimo > 0 && emMaos < minimo;

  return (
    <span className="flex shrink-0 items-center gap-4">
      {reservado > 0 && (
        <span className="hidden text-right sm:block">
          <span className="block text-2xs text-subtle">reservado</span>
          <span className="block text-sm text-muted tabular-nums" data-numeric>
            {formatar(saldo.reserved)}
          </span>
        </span>
      )}
      <span className="text-right">
        <span className="block text-2xs text-subtle">disponível</span>
        <span
          className={cn(
            'block text-sm font-medium tabular-nums',
            disponivel <= 0 ? 'text-bad-text' : 'text-text'
          )}
          data-numeric
        >
          {formatar(saldo.available)}
        </span>
      </span>
      {abaixo && (
        <StatusChip tone="warn" size="sm" hint={`Mínimo definido: ${formatar(saldo.min_qty)}`}>
          <AlertTriangle aria-hidden="true" className="mr-1 inline size-3" />
          abaixo do mínimo
        </StatusChip>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O extrato, e o ajuste.
 *
 * O ajuste mora AQUI, e não numa tela de cadastro, porque é aqui que a dúvida
 * aparece: alguém olha o saldo, confere a prateleira, e os dois não batem. Se
 * ajustar exigisse ir a outro lugar, o hábito real seria não ajustar — e o
 * sistema passaria a discordar do mundo em silêncio.
 */
function GavetaDoItem({ saldo, onFechar }: { saldo: StockBalance; onFechar: () => void }) {
  const [ajustando, setAjustando] = useState(false);

  const { data, isLoading } = useApiQuery(inventoryLedger, {
    query: { item: saldo.item_id, warehouse: saldo.warehouse_id, limit: 50 },
  }) as { data: { items: StockMovement[] } | undefined; isLoading: boolean };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title={saldo.item_name}
      description={`${saldo.sku} · ${saldo.warehouse_name}`}
      footer={
        <>
          <Button onClick={onFechar}>Fechar</Button>
          <Can permission="inventory.adjust">
            <Button variant="secondary" onClick={() => setAjustando(true)}>
              Ajustar saldo
            </Button>
          </Can>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3 rounded-control bg-surface-sunken p-3 text-sm">
          <div>
            <dt className="text-xs text-subtle">Em mãos</dt>
            <dd className="mt-0.5 text-base text-text tabular-nums" data-numeric>
              {formatar(saldo.on_hand)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Reservado</dt>
            <dd className="mt-0.5 text-base text-muted tabular-nums" data-numeric>
              {formatar(saldo.reserved)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Disponível</dt>
            <dd className="mt-0.5 text-base font-medium text-text tabular-nums" data-numeric>
              {formatar(saldo.available)}
            </dd>
          </div>
        </dl>

        <Card>
          <CardHeader
            title="Extrato"
            description="Na ordem do razão — é ela que explica como o saldo chegou onde está."
          />
          <div className="max-h-80 overflow-y-auto p-2">
            {isLoading ? (
              <SkeletonList rows={5} label="movimentos" />
            ) : !data || data.items.length === 0 ? (
              <EmptyState
                icon={<ArrowLeftRight className="size-5" />}
                title="Sem movimentação"
                className="py-6"
              />
            ) : (
              <ul className="flex flex-col">
                {data.items.map((m, i) => (
                  <li
                    key={String(m.sequence)}
                    className={cn(
                      'flex items-baseline gap-3 px-2.5 py-2 text-sm',
                      i > 0 && 'border-t border-border-subtle',
                      // O estorno é marcado, e não escondido: apagá-lo do
                      // extrato deixaria o saldo certo e a história errada.
                      m.reverses_id && 'bg-surface-sunken'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-text">
                        {ROTULO_MOVIMENTO[m.kind] ?? m.kind}
                        {m.reverses_id && <span className="text-muted"> (estorno)</span>}
                      </span>
                      {m.reason && <span className="block text-xs text-muted">{m.reason}</span>}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-sm tabular-nums',
                        ENTRADA.has(m.kind) ? 'text-good-text' : 'text-text'
                      )}
                      data-numeric
                    >
                      {ENTRADA.has(m.kind) ? '+' : '−'}
                      {formatar(m.qty)}
                    </span>
                    <span className="w-24 shrink-0 text-right text-xs text-muted" data-numeric>
                      {formatarDataRelativa(m.occurred_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {ajustando && <DialogoAjuste saldo={saldo} onFechar={() => setAjustando(false)} />}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function DialogoAjuste({ saldo, onFechar }: { saldo: StockBalance; onFechar: () => void }) {
  const toast = useToast();
  const [contado, setContado] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const emMaos = Number(saldo.on_hand);
  const contagem = contado.trim() === '' ? null : Number(contado);
  const diferenca = contagem === null || !Number.isFinite(contagem) ? null : contagem - emMaos;

  const ajustar = useApiMutation(inventoryAdjust, {
    invalidates: [inventoryBalances, inventoryLedger],
    onError: (e: ApiError) => setErro(e.problem.message),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onFechar()}
      title="Ajustar saldo"
      description={`${saldo.item_name} · ${saldo.warehouse_name}`}
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant="primary"
            loading={ajustar.isPending}
            onClick={() => {
              if (diferenca === null) {
                setErro('Informe quanto foi contado na prateleira.');
                return;
              }
              if (diferenca === 0) {
                setErro('A contagem bate com o sistema. Não há o que ajustar.');
                return;
              }
              if (motivo.trim().length < 5) {
                setErro('Escreva o motivo. Sem ele, furto, quebra e erro de lançamento viram a mesma linha.');
                return;
              }
              ajustar.mutate(
                {
                  body: {
                    item_id: saldo.item_id,
                    warehouse_id: saldo.warehouse_id,
                    qty: diferenca,
                    reason: motivo.trim(),
                  },
                },
                {
                  onSuccess: () => {
                    toast.success('Saldo ajustado', `Diferença de ${diferenca > 0 ? '+' : ''}${diferenca}.`);
                    onFechar();
                  },
                }
              );
            }}
          >
            Registrar ajuste
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/*
         * A PESSOA INFORMA O QUE CONTOU, e não a diferença.
         *
         * Pedir a diferença obriga quem está com a prateleira na frente a fazer
         * a subtração de cabeça — e a errar o sinal, que é o erro que produz um
         * ajuste no dobro do tamanho, na direção contrária.
         */}
        <Field
          label="Quanto há na prateleira"
          required
          error={erro}
          hint={`O sistema diz ${formatar(saldo.on_hand)}. Informe o que você contou.`}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={contado}
            onChange={(e) => setContado(e.target.value)}
            autoFocus
          />
        </Field>

        {diferenca !== null && diferenca !== 0 && (
          <p
            className={cn(
              'rounded-control px-3 py-2 text-sm',
              diferenca > 0 ? 'bg-good-soft text-good-text' : 'bg-warn-soft text-warn-text'
            )}
          >
            O ajuste será de{' '}
            <strong data-numeric>
              {diferenca > 0 ? '+' : ''}
              {diferenca}
            </strong>{' '}
            — {diferenca > 0 ? 'há mais na prateleira do que no sistema' : 'falta na prateleira'}.
          </p>
        )}

        <Field
          label="Motivo"
          required
          hint="Quem ler daqui a seis meses precisa saber se foi furto, quebra ou erro de lançamento."
        >
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Ex.: duas unidades danificadas no transporte, descartadas."
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

const ROTULO_MOVIMENTO: Record<string, string> = {
  receipt: 'Recebimento',
  issue: 'Saída',
  adjustment: 'Ajuste',
  transfer_out: 'Transferência (saída)',
  transfer_in: 'Transferência (entrada)',
  consumption: 'Consumo em OS',
  return: 'Devolução de OS',
  scrap: 'Descarte',
};

/** Os tipos que AUMENTAM o saldo. */
const ENTRADA = new Set(['receipt', 'transfer_in', 'return']);

/**
 * Formata a quantidade que veio como TEXTO.
 *
 * `Number()` só para escolher se mostra casas decimais — o valor exibido é o
 * texto original quando ele tem fração, porque `numeric` guarda mais precisão
 * do que o ponto flutuante consegue devolver.
 */
function formatar(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  return Number.isInteger(n) ? String(n) : valor.replace(/0+$/, '').replace(/\.$/, '');
}
