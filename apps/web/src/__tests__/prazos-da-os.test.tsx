/**
 * Aurora — os prazos do contrato no cabeçalho da OS (conversa com o cliente, 23/10/2026).
 *
 * "Acha realmente necessário este lance de onsite e execução? Esta barra gráfica… está vermelha
 * aí." As barras viraram etiquetas, e a chave crua `onsite` ganhou nome em português.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sla } from '../features/ordens/ficha';

const base = {
  target_minutes: 240,
  paused_minutes: 0,
  elapsed_business_minutes: 300,
  started_at: '2026-10-14T12:00:00.000Z',
};

describe('prazos do contrato na OS', () => {
  it('sem barra de progresso e sem a chave crua "onsite"', () => {
    render(
      <Sla
        relogios={
          [
            {
              ...base,
              id: '00000000-0000-4000-8000-000000000001',
              kind: 'onsite',
              state: 'running',
              due_at: '2026-10-14T16:00:00.000Z',
              breached_at: '2026-10-14T16:00:00.000Z',
              consumed_pct: 125,
            },
            {
              ...base,
              id: '00000000-0000-4000-8000-000000000002',
              kind: 'resolution',
              state: 'met',
              due_at: '2026-10-15T16:00:00.000Z',
              breached_at: null,
              consumed_pct: 40,
            },
            {
              ...base,
              id: '00000000-0000-4000-8000-000000000003',
              kind: 'response',
              state: 'cancelled',
              due_at: '2026-10-15T16:00:00.000Z',
              breached_at: null,
              consumed_pct: 0,
            },
          ] as never
        }
      />
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('prazos-sla').textContent).not.toMatch(/onsite/);
    expect(screen.getByText(/Chegada ao local: vencido/)).toBeTruthy();
    expect(screen.getByText('Solução: cumprido')).toBeTruthy();
    // Relógio cancelado não aparece.
    expect(screen.queryByText(/Atendimento/)).toBeNull();
  });

  it('sem relógio, nada é desenhado', () => {
    const { container } = render(<Sla relogios={null} />);
    expect(container.innerHTML).toBe('');
  });
});
