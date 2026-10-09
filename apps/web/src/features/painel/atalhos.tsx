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
  Plus,
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
  // Criar primeiro: são as ações; o resto é atalho de navegação.
  const atalhos = [...atalhosPara(can)].sort((a, b) => Number(b.criar) - Number(a.criar));
  if (atalhos.length === 0) return null;

  /*
   * AÇÕES RÁPIDAS BAIXAS, e não uma fileira de cartões: 44px de altura, sem
   * moldura em volta. Criar tem o quadrado azul com "+" — é a única cor da
   * faixa —; navegar tem o ícone em traço neutro. O título fica só para o
   * leitor de tela: os rótulos já dizem o que cada uma faz.
   */
  return (
    <nav aria-labelledby="atalhos-rapidos">
      <h2 id="atalhos-rapidos" className="aurora-sr-only">
        Atalhos rápidos
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {atalhos.map((a) => {
          const Icone = a.icone;
          return (
            <li key={a.chave}>
              <Link
                to={a.para}
                search={(a.busca ?? {}) as never}
                className={cn(
                  'group flex h-11 items-center gap-2.5 rounded-[12px] bg-surface px-3 text-sm shadow-card transition-[box-shadow,background-color] hover:shadow-raised',
                  a.criar ? 'font-semibold text-text' : 'font-medium text-muted hover:text-text'
                )}
              >
                {a.criar ? (
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-accent text-on-accent"
                  >
                    <Plus className="size-3.5" strokeWidth={2.5} />
                  </span>
                ) : (
                  <Icone
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="size-[18px] shrink-0 text-subtle transition-colors group-hover:text-accent-text"
                  />
                )}
                <span className="line-clamp-2 leading-tight">{a.rotulo}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
