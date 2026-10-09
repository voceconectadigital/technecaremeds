/**
 * Aurora — Atalhos rápidos do Painel de Controle.
 *
 * CHEGAR À OPERAÇÃO SEM PASSAR PELA BARRA LATERAL — E SÓ PELO QUE EXISTE.
 *
 * Cada atalho abre uma rota REAL que já existia. "Novo X" só aparece quando o
 * fluxo de criação existe na web E a pessoa pode criar; senão o atalho vira a
 * listagem, se ela pode ver. Não há "Nova OS": por desenho, a OS nasce da
 * triagem da solicitação ou de um plano (`routes/hoje-fluxo.tsx`) — o atalho
 * leva às Ordens de serviço.
 *
 * Esconder aqui é conforto, não segurança: cada rota e cada escrita continua
 * conferida pelo servidor.
 *
 * `atalhosPara` é pura (recebe o `can`) para ser testada sem navegador.
 */
import { Link } from '@tanstack/react-router';
import {
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardList,
  FilePlus2,
  FileText,
  Inbox,
  Package,
  PackagePlus,
  Receipt,
  Repeat,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { usePermissions } from '@aurora/app-kit';
import { cn } from '@aurora/ui';

export interface Atalho {
  chave: string;
  rotulo: string;
  para: string;
  /** Busca da rota (ex.: `{ novo: 'sim' }` abre o diálogo de cadastro). */
  busca?: Record<string, string>;
  icone: LucideIcon;
  /** Ação de criar (destaque) ou ir a uma lista. */
  criar: boolean;
}

type Pode = (...permissoes: string[]) => boolean;

/** O atalho de criar quando pode criar; senão a lista quando pode ver; senão nada. */
function criarOuListar(
  can: Pode,
  criar: Omit<Atalho, 'criar'> & { permissao: string },
  listar: Omit<Atalho, 'criar'> & { permissao: string }
): Atalho | null {
  if (can(criar.permissao)) return { ...criar, criar: true };
  if (can(listar.permissao)) return { ...listar, criar: false };
  return null;
}

export function atalhosPara(can: Pode): Atalho[] {
  const lista: Array<Atalho | null> = [
    criarOuListar(
      can,
      {
        chave: 'solicitacao',
        rotulo: 'Nova solicitação',
        para: '/solicitacoes/nova',
        icone: FilePlus2,
        permissao: 'service_request.create',
      },
      {
        chave: 'solicitacao',
        rotulo: 'Solicitações',
        para: '/solicitacoes',
        icone: Inbox,
        permissao: 'service_request.read',
      }
    ),
    can('work_order.read')
      ? { chave: 'ordens', rotulo: 'Ordens de serviço', para: '/ordens', icone: ClipboardList, criar: false }
      : null,
    criarOuListar(
      can,
      {
        chave: 'cliente',
        rotulo: 'Novo cliente',
        para: '/clientes',
        busca: { novo: 'sim' },
        icone: UserPlus,
        permissao: 'customer.create',
      },
      {
        chave: 'cliente',
        rotulo: 'Clientes',
        para: '/clientes',
        icone: Building2,
        permissao: 'customer.read',
      }
    ),
    criarOuListar(
      can,
      {
        chave: 'ativo',
        rotulo: 'Novo equipamento',
        para: '/ativos',
        busca: { novo: 'sim' },
        icone: PackagePlus,
        permissao: 'asset.create',
      },
      { chave: 'ativo', rotulo: 'Equipamentos', para: '/ativos', icone: Boxes, permissao: 'asset.read' }
    ),
    can('maintenance_plan.read')
      ? { chave: 'planos', rotulo: 'Planos de manutenção', para: '/planos', icone: Repeat, criar: false }
      : null,
    can('work_order.read')
      ? { chave: 'agenda', rotulo: 'Agenda', para: '/agenda', icone: CalendarDays, criar: false }
      : null,
    can('inventory.read')
      ? { chave: 'estoque', rotulo: 'Estoque', para: '/estoque', icone: Package, criar: false }
      : null,
    can('contract.read')
      ? { chave: 'contratos', rotulo: 'Contratos', para: '/contratos', icone: FileText, criar: false }
      : null,
    can('quote.read')
      ? { chave: 'orcamentos', rotulo: 'Orçamentos', para: '/orcamentos', icone: Receipt, criar: false }
      : null,
    can('insight.read')
      ? { chave: 'indicadores', rotulo: 'Indicadores', para: '/indicadores', icone: BarChart3, criar: false }
      : null,
  ];
  return lista.filter((a): a is Atalho => a !== null);
}

export function AtalhosRapidos() {
  const { can } = usePermissions();
  const atalhos = atalhosPara(can);
  if (atalhos.length === 0) return null;

  return (
    <nav
      aria-labelledby="atalhos-rapidos"
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-2 shadow-card lg:flex-row lg:items-center lg:gap-3"
    >
      <h2
        id="atalhos-rapidos"
        className="shrink-0 px-2 text-2xs font-semibold tracking-[0.08em] text-subtle uppercase lg:border-r lg:border-border-subtle lg:pr-4"
      >
        Atalhos rápidos
      </h2>
      <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] lg:flex-wrap lg:overflow-visible">
        {atalhos.map((a) => {
          const Icone = a.icone;
          return (
            <li key={a.chave}>
              <Link
                to={a.para}
                search={(a.busca ?? {}) as never}
                className={cn(
                  'group inline-flex h-9 items-center gap-2 rounded-control px-2.5 text-sm whitespace-nowrap transition-colors',
                  a.criar
                    ? 'font-semibold text-accent-text hover:bg-accent-soft'
                    : 'font-medium text-muted hover:bg-surface-hover hover:text-text'
                )}
              >
                <Icone
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className={cn(
                    'size-4 shrink-0',
                    a.criar ? 'text-accent-text' : 'text-subtle group-hover:text-text'
                  )}
                />
                {a.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
