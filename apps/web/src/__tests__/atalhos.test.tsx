/**
 * Aurora — Atalhos rápidos do Painel de Controle.
 *
 * Três coisas que um atalho não pode fazer: levar a uma rota que não existe,
 * oferecer "criar" a quem não pode criar, e sumir para quem pode ver a lista.
 */
import { describe, it, expect } from 'vitest';
import { atalhosPara } from '../features/painel/atalhos';
import { routeTree } from '../routes/router';
import { FACTORY_ROLES, permissionsOfRole } from '@aurora/domain';

const pode =
  (lista: string[]) =>
  (...p: string[]) =>
    p.every((x) => lista.includes(x));

/** Os caminhos que o roteador conhece, lidos da árvore de rotas real. */
function caminhosDoRoteador(): Set<string> {
  const caminhos = new Set<string>();
  const filhos = (routeTree as unknown as { children?: unknown }).children;
  const lista = Array.isArray(filhos) ? filhos : Object.values((filhos ?? {}) as Record<string, unknown>);
  for (const r of lista as Array<{ options?: { path?: string } }>) {
    if (r.options?.path) caminhos.add(r.options.path);
  }
  return caminhos;
}

describe('atalhos rápidos', () => {
  it('com todas as permissões: os dez atalhos, os de criar onde há fluxo de criar', () => {
    const todos = atalhosPara(() => true);
    expect(todos.map((a) => a.rotulo)).toEqual([
      'Nova solicitação',
      'Ordens de serviço',
      'Novo cliente',
      'Novo equipamento',
      'Planos de manutenção',
      'Agenda',
      'Estoque',
      'Contratos',
      'Orçamentos',
      'Indicadores',
    ]);
    // Não existe "Nova OS" na web: por desenho a OS nasce da triagem ou de um plano.
    expect(todos.find((a) => a.chave === 'ordens')!.criar).toBe(false);
  });

  it('todo atalho abre uma rota que o roteador conhece — nenhum 404', () => {
    const caminhos = caminhosDoRoteador();
    expect(caminhos.size).toBeGreaterThan(10);
    for (const a of atalhosPara(() => true)) {
      expect(caminhos.has(a.para), `${a.rotulo} → ${a.para}`).toBe(true);
    }
  });

  it('quem vê mas não cria recebe a LISTA, e não o "novo"', () => {
    const a = atalhosPara(pode(['customer.read', 'asset.read', 'service_request.read']));
    expect(a.map((x) => x.rotulo)).toEqual(['Solicitações', 'Clientes', 'Equipamentos']);
    expect(a.every((x) => !x.criar && !x.busca)).toBe(true);
  });

  it('quem não vê nada não recebe atalho nenhum', () => {
    expect(atalhosPara(pode([]))).toEqual([]);
  });

  it('o gestor do cliente (hospital) não recebe ações que o papel não tem', () => {
    // O papel de fábrica `customer_manager` (assento de portal), como está no domínio.
    const papel = FACTORY_ROLES.find((r) => r.key === 'customer_manager')!;
    const hospital = permissionsOfRole(papel);
    const a = atalhosPara(pode(hospital)).map((x) => x.rotulo);
    expect(a).not.toContain('Novo cliente');
    expect(a).not.toContain('Novo equipamento');
    expect(a).not.toContain('Estoque');
    expect(a).toContain('Nova solicitação');
    expect(a).toContain('Clientes');
  });
});
