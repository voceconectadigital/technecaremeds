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
import { useApiQuery } from '../lib/api';

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

/** Para onde cada tipo de resultado leva. */
const ROTAS: Record<SearchScope, (id: string) => string> = {
  asset: (id) => `/ativos/${id}`,
  work_order: (id) => `/ordens/${id}`,
  service_request: (id) => `/solicitacoes/${id}`,
  customer: (id) => `/clientes/${id}`,
  location: (id) => `/locais/${id}`,
  inventory_item: (id) => `/estoque/${id}`,
  document: (id) => `/documentos/${id}`,
  quote: (id) => `/orcamentos/${id}`,
  person: (id) => `/pessoas/${id}`,
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
        onSelect: () => void navigate({ to: ROTAS[h.scope](h.id) }),
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
