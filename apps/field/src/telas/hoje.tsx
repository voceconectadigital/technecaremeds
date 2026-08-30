/**
 * Aurora — o dia do técnico (SPEC v0.2 §20 · EPIC-014).
 *
 * A LISTA VEM DA BASE LOCAL, SEMPRE — inclusive com sinal cheio.
 *
 * Ler da rede "quando dá" dá à tela dois modos: o rápido e o vazio. O segundo
 * aparece exatamente no subsolo, e ali o técnico não tem como distinguir "não
 * tenho OS hoje" de "o wi-fi não alcança". Lendo do local, a tela tem um modo
 * só; o que muda com a rede é quão recente é o dado, e isso está escrito no
 * topo, em português.
 */
import { Link } from '@tanstack/react-router';
import { useCampo, useColecaoLocal } from '../campo';

interface OrdemLocal {
  id: string;
  number: string | null;
  title: string;
  status_key: string;
  status_label: string;
  category: string;
  priority: string;
  asset_name_snapshot: string | null;
  location_name_snapshot: string | null;
  scheduled_start: string | null;
}

/** Quando o pacote chegou, dito em português e não em ISO. */
function quando(iso: string | null): string {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  const minutos = Math.round((Date.now() - d.getTime()) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return d.toLocaleDateString('pt-BR');
}

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function HojePage() {
  const { linhas, carregando } = useColecaoLocal<OrdemLocal>('ordens');
  const { ultimaSincronizacao, sincronizar, sincronizando } = useCampo();

  const ordens = [...linhas].sort((a, b) => {
    // Com horário primeiro, na ordem do dia; sem horário depois. É a ordem em
    // que a pessoa vai atacá-las, e não a ordem alfabética de nada.
    if (a.scheduled_start && b.scheduled_start) {
      return a.scheduled_start.localeCompare(b.scheduled_start);
    }
    if (a.scheduled_start) return -1;
    if (b.scheduled_start) return 1;
    return a.title.localeCompare(b.title);
  });

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-lg font-semibold text-text">Hoje</h1>

      {/*
        A IDADE DO DADO FICA VISÍVEL, sempre.

        É o que substitui o indicador de "carregando" que uma tela conectada
        teria. Sem ele, o técnico não tem como saber se a OS que a coordenação
        acabou de atribuir já chegou ao aparelho.
      */}
      <p className="mt-0.5 text-xs text-subtle">
        Dados do aparelho, sincronizados {quando(ultimaSincronizacao)}.{' '}
        <button
          type="button"
          onClick={() => void sincronizar()}
          className="underline underline-offset-2"
          disabled={sincronizando}
        >
          {sincronizando ? 'sincronizando…' : 'sincronizar agora'}
        </button>
      </p>

      {carregando ? (
        <p className="mt-6 text-sm text-muted" role="status">
          Lendo o aparelho…
        </p>
      ) : ordens.length === 0 ? (
        /*
         * VAZIO EXPLICADO, e com a causa mais provável dita.
         *
         * "Nenhuma OS" sozinho faz o técnico ficar olhando a tela sem saber se
         * o problema é dele. As duas causas possíveis estão escritas, e a ação
         * de cada uma também.
         */
        <div className="mt-8 rounded-panel border border-border-subtle bg-surface p-4">
          <p className="text-sm font-medium text-text">Nenhuma ordem no aparelho</p>
          <p className="mt-1 text-sm text-muted">
            {ultimaSincronizacao
              ? 'Você não tem ordens atribuídas para os próximos dias. Se a coordenação acabou de atribuir alguma, sincronize.'
              : 'Este aparelho ainda não baixou o seu dia. Toque em sincronizar enquanto tiver rede — depois disso ele funciona sem.'}
          </p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {ordens.map((o) => (
            <li key={o.id}>
              <Link
                to="/ordens/$id"
                params={{ id: o.id }}
                className="flex min-h-16 flex-col gap-1 rounded-panel border border-border-subtle bg-surface p-3"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-subtle">{o.number ?? 'sem número'}</span>
                  <span className="text-xs text-muted">
                    {o.scheduled_start ? HORA.format(new Date(o.scheduled_start)) : 'sem horário'}
                  </span>
                </span>
                <span className="text-sm font-medium text-text">{o.title}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span>{o.status_label}</span>
                  {o.asset_name_snapshot && <span>· {o.asset_name_snapshot}</span>}
                  {o.location_name_snapshot && <span>· {o.location_name_snapshot}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
