/**
 * Aurora — o menu principal (SPEC v0.2 §34, §40).
 *
 * COMO ESTA LISTA FOI DECIDIDA
 *
 * Por DOMÍNIO do trabalho, não por tabela do banco e não copiando o menu do
 * sistema de referência. A pergunta que cada item responde é uma pergunta que
 * alguém faz em voz alta durante o expediente:
 *
 *   "o que precisa de mim agora?"        → Hoje
 *   "o que estão pedindo?"               → Solicitações
 *   "o que está em andamento?"           → Ordens de serviço
 *   "quem vai fazer o quê, e quando?"    → Agenda
 *   "que equipamento é esse?"            → Ativos
 *   "tem a peça?"                        → Estoque
 *   "quanto custa, e o que foi acordado?"→ Contratos
 *   "como estamos indo?"                 → Indicadores
 *
 * Oito itens. Acima disso a barra deixa de ser navegação e vira lista para
 * procurar — e quem procura usa a busca, não o menu.
 *
 * CADA ITEM DECLARA A PERMISSÃO QUE O TORNA ÚTIL. Um item que leva a um 403 é
 * pior do que um item ausente: a pessoa clica, recebe a negativa e não sabe se
 * errou o caminho ou se o sistema quebrou.
 */
import {
  Sun,
  Inbox,
  ClipboardList,
  CalendarDays,
  Boxes,
  Package,
  FileText,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Basta UMA destas para o item aparecer. */
  permissions: readonly string[];
  /** Uma frase para a dica quando a barra está recolhida. */
  hint: string;
}

export const MAIN_NAV: readonly NavItem[] = Object.freeze([
  {
    to: '/',
    label: 'Hoje',
    icon: Sun,
    // Não exige permissão especial: é a tela de quem entrou, seja quem for. O
    // conteúdo dela é que muda conforme o papel.
    permissions: [],
    hint: 'O que precisa de você agora',
  },
  {
    to: '/solicitacoes',
    label: 'Solicitações',
    icon: Inbox,
    permissions: ['service_request.read'],
    hint: 'O que estão pedindo, e o que ainda não foi triado',
  },
  {
    to: '/ordens',
    label: 'Ordens de serviço',
    icon: ClipboardList,
    permissions: ['work_order.read'],
    hint: 'O que está em andamento',
  },
  {
    to: '/agenda',
    label: 'Agenda',
    icon: CalendarDays,
    permissions: ['work_order.read'],
    hint: 'Quem faz o quê, e quando',
  },
  {
    to: '/ativos',
    label: 'Ativos',
    icon: Boxes,
    permissions: ['asset.read'],
    hint: 'Equipamentos, locais e histórico',
  },
  {
    to: '/estoque',
    label: 'Estoque',
    icon: Package,
    permissions: ['inventory.read'],
    hint: 'Peças, saldos e requisições',
  },
  {
    to: '/contratos',
    // O rótulo nomeia o item principal, e a tela traz o alternador para o
    // vizinho. Um nono item no menu custaria mais do que ganha.
    label: 'Contratos',
    icon: FileText,
    permissions: ['contract.read', 'quote.read'],
    hint: 'O que foi acordado, e o que foi orçado',
  },
  {
    to: '/indicadores',
    label: 'Indicadores',
    icon: BarChart3,
    permissions: ['insight.read'],
    hint: 'Como estamos indo',
  },
]);

/**
 * Configurações fica fora da lista principal, no rodapé da barra.
 *
 * Não é trabalho do dia: é o que se mexe uma vez por mês. Misturá-la com as
 * oito faz a pessoa passar por ela oito horas por dia sem precisar.
 */
export const SETTINGS_NAV: NavItem = {
  to: '/configuracoes',
  label: 'Configurações',
  icon: Settings,
  permissions: ['organization.manage_members', 'organization.manage_catalogs', 'organization.manage_roles'],
  hint: 'Pessoas, papéis, catálogos e campos',
};
