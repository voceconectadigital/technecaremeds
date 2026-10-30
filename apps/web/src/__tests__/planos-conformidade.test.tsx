/**
 * Aurora — planos na tela (rodada de 29/10/2026).
 *
 *   · PLN-08  "Aceite" não aparece na criação nem nos filtros de procedimento (o antigo ainda abre);
 *   · PLN-10  a conformidade por plano aparece em % com o denominador explicado;
 *   · REL-12  a tabela do ranking segue a ordem do servidor e não inventa posição sem denominador;
 *   · ORC-05  cada linha de espera leva à OS — ou ao orçamento, quando ele não tem OS.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  FILTROS_DE_PROCEDIMENTO,
  FiltroDeTipoDeProcedimento,
  SeletorDeTipoDeProcedimento,
  opcoesDeTipoNoFormulario,
} from '../features/planos/procedimentos';
import {
  DEFINICAO_DO_DENOMINADOR,
  Distribuicao,
  FiltroDeSetores,
  TabelaDoRanking,
  formatarTaxa,
  setoresDaUrl,
  taxaDeConformidade,
} from '../features/planos/conformidade';
import { destinoDaLinha } from '../routes/hoje-espera';

describe('PLN-08 · sem "Aceite" na criação e nos filtros de procedimento', () => {
  it('os chips de filtro não oferecem Aceite', () => {
    render(<FiltroDeTipoDeProcedimento filtro="" onFiltro={() => undefined} />);
    const grupo = screen.getByRole('group', { name: 'Tipo de procedimento' });
    expect(within(grupo).queryByText(/Aceite/i)).toBeNull();
    expect(within(grupo).getByText('Todos')).toBeTruthy();
    expect(FILTROS_DE_PROCEDIMENTO.some((f) => f.v === 'acceptance')).toBe(false);
  });

  it('o formulário de novo procedimento não oferece Aceite', () => {
    render(<SeletorDeTipoDeProcedimento tipo="" onTipo={() => undefined} />);
    const opcoes = within(screen.getByLabelText('Tipo de procedimento')).getAllByRole('option');
    expect(opcoes.map((o) => o.textContent)).not.toContain('Aceite');
    expect(opcoes.map((o) => (o as HTMLOptionElement).value)).toEqual([
      '',
      'calibration',
      'electrical_safety',
      'qualification',
    ]);
  });

  it('um procedimento ANTIGO de Aceite ainda abre com o tipo dele', () => {
    expect(opcoesDeTipoNoFormulario('acceptance').map((o) => o.v)).toContain('acceptance');
  });
});

describe('PLN-10 · conformidade por plano em %', () => {
  it('realizados ÷ (programados − dispensados); sem denominador é nulo', () => {
    expect(taxaDeConformidade({ done: 1, pending: 0, late: 1, skipped: 3 })).toBe(50);
    expect(taxaDeConformidade({ done: 1, pending: 1, late: 1, skipped: 0 })).toBe(33.3);
    expect(taxaDeConformidade({ done: 0, pending: 0, late: 0, skipped: 2 })).toBeNull();
    expect(formatarTaxa(null)).toBe('—');
  });

  it('cada plano mostra o percentual e a fração', () => {
    render(
      <Distribuicao
        titulo="Por plano"
        linhas={[
          { key: 'p1', label: 'Preventiva UTI', done: 1, pending: 0, late: 1, skipped: 1 },
          { key: 'p2', label: 'Preventiva CC', done: 0, pending: 0, late: 0, skipped: 2 },
        ]}
      />
    );
    expect(screen.getByTestId('conformidade-p1').textContent).toContain('50%');
    expect(screen.getByTestId('conformidade-p1').textContent).toContain('1 de 2');
    expect(screen.getByTestId('conformidade-p2').textContent).toContain('—');
    // O denominador vem escrito no cartão.
    expect(screen.getByText(/programados − dispensados/)).toBeTruthy();
  });

  it('a definição explica o denominador', () => {
    expect(DEFINICAO_DO_DENOMINADOR).toMatch(/dispensados/);
    expect(DEFINICAO_DO_DENOMINADOR).toMatch(/previstos/);
  });
});

describe('PLN-11 · vários setores', () => {
  it('a URL guarda a lista e os chips alternam cada setor', () => {
    expect(setoresDaUrl('')).toEqual([]);
    expect(setoresDaUrl('a,b')).toEqual(['a', 'b']);
    let escolhidos: string[] = ['a'];
    render(
      <FiltroDeSetores
        setores={[
          { id: 'a', name: 'UTI' },
          { id: 'b', name: 'CC' },
        ]}
        escolhidos={escolhidos}
        onChange={(ids) => (escolhidos = ids)}
      />
    );
    fireEvent.click(screen.getByText('CC'));
    expect(escolhidos).toEqual(['a', 'b']);
  });
});

describe('REL-12 · tabela do ranking', () => {
  it('mostra a ordem recebida, a taxa e "de quanto"; sem denominador não tem posição', () => {
    const base = { pending: 0, late: 0, skipped: 0 };
    render(
      <TabelaDoRanking
        rotulo="Plano"
        linhas={[
          {
            ...base,
            position: 1,
            key: 'a',
            label: 'Plano A',
            scheduled: 2,
            done: 2,
            denominator: 2,
            rate: 100,
          },
          {
            ...base,
            position: 2,
            key: 'b',
            label: 'Plano B',
            scheduled: 10,
            done: 5,
            late: 5,
            denominator: 10,
            rate: 50,
          },
          {
            ...base,
            position: 3,
            key: 'c',
            label: 'Plano C',
            scheduled: 1,
            done: 0,
            skipped: 1,
            denominator: 0,
            rate: null,
          },
        ]}
      />
    );
    const linhas = screen.getAllByRole('row').slice(1);
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringContaining('Plano A'),
      expect.stringContaining('Plano B'),
      expect.stringContaining('Plano C'),
    ]);
    expect(linhas[1]!.textContent).toContain('50%');
    expect(linhas[1]!.textContent).toContain('5 de 10');
    expect(within(linhas[2]!).getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('ORC-05 · cada linha de espera leva ao lugar certo', () => {
  const linha = {
    reason: 'quote' as const,
    work_order_number: null,
    title: 'x',
    quote_number: 'QT-1',
    quote_status: 'sent',
    customer_id: '00000000-0000-4000-8000-000000000001',
    customer_name: 'Hospital',
    sector_id: null,
    sector_name: null,
    assignee_membership_id: null,
    assignee_name: null,
    asset_name: null,
    wait_reason_label: null,
    since: null,
  };
  it('com OS: a ficha da OS', () => {
    expect(
      destinoDaLinha({ ...linha, kind: 'work_order', work_order_id: 'os-1', quote_id: 'q-1' } as never)
    ).toEqual({ to: '/ordens/$id', params: { id: 'os-1' } });
  });
  it('sem OS: o orçamento', () => {
    expect(
      destinoDaLinha({ ...linha, kind: 'quote', work_order_id: null, quote_id: 'q-2' } as never)
    ).toEqual({
      to: '/orcamentos/$id',
      params: { id: 'q-2' },
    });
  });
});
