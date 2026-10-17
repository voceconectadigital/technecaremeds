/**
 * Portal — falha de carga não se apresenta como "nada pendente".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const refetch = vi.fn();
vi.mock('@aurora/app-kit', () => ({
  useApiQuery: () => ({ data: undefined, isLoading: false, isError: true, refetch }),
}));
vi.mock('../../casca', () => ({
  Casca: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

import { InicioPage } from '../inicio';

describe('Início do portal com a API fora', () => {
  it('diz que não carregou, oferece tentar de novo, e não diz "nada aguardando"', () => {
    render(<InicioPage />);
    expect(screen.getByText('Não conseguimos carregar agora')).toBeTruthy();
    expect(screen.queryByText('Nada aguardando você')).toBeNull();
    expect(screen.queryByText('Nenhum chamado aberto')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
