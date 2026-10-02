/**
 * Aurora — a busca global do esqueleto (SPEC v0.2 §27 · EPIC-025).
 *
 * O componente de paleta vem do design system; aqui mora a ligação com a API,
 * o atraso da digitação e para onde cada resultado leva.
 */
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Boxes, ClipboardList, FileText, Inbox, MapPin, Package, User, Users, Zap } from 'lucide-react';
import { CommandPalette, type CommandItem } from '@aurora/ui';
import { searchGlobal, type SearchResult, type SearchScope } from '@aurora/contracts';
import { useApiQuery } from '@aurora/app-kit';

const ICONES: Record<SearchScope, typeof Boxes> = {
  asset: Boxes,
  work_order: ClipboardList,
  service_request: Inbox,
  customer: Users,
  location: MapPin,
  inventory_item: Package,
  document: FileText,
  quote: FileText,
  person: User,
};

/**
 * Para onde cada tipo de resultado leva — SEMPRE para uma tela que existe.
 *
 * Cinco destinos apontavam para rotas que nunca existiram (`/clientes/:id`,
 * `/locais/:id`, `/estoque/:id`, `/documentos/:id`, `/pessoas/:id`): o
 * resultado aparecia e o clique dava "página não encontrada". Agora cada um vai
 * à tela mais próxima que existe, já filtrada pelo que foi achado. Ficha de
 * cliente e de pessoa não existem nesta versão (são pedidos registrados à
 * parte); por isso cliente leva aos contratos e pessoa às configurações.
 */
type Destino = { to: string; search?: Record<string, string> };
const ROTAS: Record<SearchScope, (hit: { id: string; title: string }) => Destino> = {
  asset: (h) => ({ to: `/ativos/${h.id}` }),
  work_order: (h) => ({ to: `/ordens/${h.id}` }),
  service_request: (h) => ({ to: `/solicitacoes/${h.id}` }),
  customer: () => ({ to: '/contratos' }),
  location: (h) => ({ to: '/ativos', search: { local: h.id } }),
  inventory_item: (h) => ({ to: '/estoque', search: { aba: 'tudo', q: h.title } }),
  document: (h) => ({ to: '/documentos', search: { aba: 'todos', q: h.title } }),
  quote: (h) => ({ to: `/orcamentos/${h.id}` }),
  person: () => ({ to: '/configuracoes' }),
};

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [termo, setTermo] = useState('');
  const [atrasado, setAtrasado] = useState('');

  /*
   * Atraso de 200ms na digitação.
   *
   * Sem ele, "ventilador" dispara onze buscas e a décima primeira pode voltar
   * antes da nona — o resultado piscando entre estados antigos é pior do que a
   * espera. 200ms é abaixo do que se percebe como lentidão e acima do
   * intervalo entre duas teclas de quem digita rápido.
   */
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(termo.trim()), 200);
    return () => clearTimeout(t);
  }, [termo]);

  // Fechar limpa: reabrir com a busca anterior mostra resultado velho como se
  // fosse novo.
  useEffect(() => {
    if (!open) {
      setTermo('');
      setAtrasado('');
    }
  }, [open]);

  const habilitada = atrasado.length >= 2;

  const { data, isFetching } = useApiQuery(
    searchGlobal,
    { query: { q: atrasado } },
    { enabled: habilitada, staleTime: 30_000, retry: false }
  ) as { data: SearchResult | undefined; isFetching: boolean };

  const itens = useMemo<CommandItem[]>(() => {
    if (!data) return [];

    const comandos: CommandItem[] = data.commands.map((c) => ({
      id: `cmd:${c.key}`,
      label: c.label,
      group: 'Ir para',
      icon: <Zap className="size-4" />,
      onSelect: () => void navigate({ to: c.action }),
    }));

    const achados: CommandItem[] = data.hits.map((h) => {
      const Icone = ICONES[h.scope];
      return {
        id: `${h.scope}:${h.id}`,
        label: h.title,
        // O rótulo do grupo vem do servidor: uma tradução própria aqui faria a
        // busca chamar de "Equipamentos" o que o resto do produto chama de
        // "Ativos".
        group: data.scopeLabels[h.scope] ?? h.scope,
        detail: h.subtitle ?? undefined,
        icon: <Icone className="size-4" />,
        onSelect: () => {
          const d = ROTAS[h.scope](h);
          // `search` depende do tipo da rota de destino; a conversão fica aqui,
          // pelo mesmo motivo do `useUrlState`.
          void navigate({ to: d.to, search: d.search as never });
        },
      };
    });

    // Comandos primeiro: quem digita "agenda" quase sempre quer IR para a
    // agenda, não achar um registro chamado agenda.
    return [...comandos, ...achados];
  }, [data, navigate]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      query={termo}
      onQueryChange={setTermo}
      items={itens}
      loading={isFetching && habilitada}
      emptyQueryHint="Digite um número de patrimônio, TAG, série ou parte de um nome. Comece com > para comandos."
    />
  );
}
