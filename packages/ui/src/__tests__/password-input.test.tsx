/**
 * Campo de senha com o olho — as promessas que quebram em silêncio.
 *
 * Mostrar a senha é fácil; o que se confere aqui é o resto: que o olho não
 * envia o formulário, que o leitor de tela sabe o que o botão faz e em que
 * estado está, que o foco e o cursor ficam onde a pessoa estava, e que o campo
 * continua ligado ao rótulo e ao erro do `Field`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, PasswordInput } from '../index';

function Formulario({ onSubmit }: { onSubmit?: (e: React.FormEvent) => void }) {
  return (
    <form onSubmit={onSubmit}>
      <Field label="Senha" error="Informe a sua senha." required>
        <PasswordInput name="senha" autoComplete="current-password" defaultValue="segredo" />
      </Field>
    </form>
  );
}

describe('PasswordInput', () => {
  it('começa escondido e o clique no olho alterna a visibilidade', async () => {
    render(<Formulario />);
    const campo = screen.getByLabelText(/Senha/);
    expect(campo).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(campo).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(campo).toHaveAttribute('type', 'password');
  });

  it('o rótulo acessível e o aria-pressed acompanham o estado', async () => {
    render(<Formulario />);
    const olho = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(olho).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(olho);
    expect(olho).toHaveAccessibleName('Ocultar senha');
    expect(olho).toHaveAttribute('aria-pressed', 'true');
    expect(olho).toHaveAttribute('aria-controls', screen.getByLabelText(/Senha/).id);
  });

  it('clicar no olho não envia o formulário', async () => {
    const enviar = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<Formulario onSubmit={enviar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(enviar).not.toHaveBeenCalled();
  });

  it('o foco e o cursor continuam no campo depois do clique', async () => {
    render(<Formulario />);
    const campo = screen.getByLabelText(/Senha/) as HTMLInputElement;
    await userEvent.click(campo);
    campo.setSelectionRange(3, 3);

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(campo).toHaveFocus();
    expect(campo.selectionStart).toBe(3);

    // E dá para continuar digitando de onde parou.
    await userEvent.keyboard('X');
    expect(campo).toHaveValue('segXredo');
  });

  it('preserva name, autoComplete e a ligação com o rótulo e o erro', () => {
    render(<Formulario />);
    const campo = screen.getByLabelText(/Senha/);
    expect(campo).toHaveAttribute('name', 'senha');
    expect(campo).toHaveAttribute('autocomplete', 'current-password');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription('Informe a sua senha.');
  });

  it('respeita o id e o ref de quem usa, também fora de um Field', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<PasswordInput id="nova-senha" autoComplete="new-password" aria-label="Nova senha" ref={ref} />);
    const campo = screen.getByLabelText('Nova senha');
    expect(campo).toHaveAttribute('id', 'nova-senha');
    expect(campo).toHaveAttribute('autocomplete', 'new-password');
    expect(ref.current).toBe(campo);
    expect(screen.getByRole('button', { name: 'Mostrar senha' })).toHaveAttribute(
      'aria-controls',
      'nova-senha'
    );
  });

  it('desabilitado, o olho também fica desabilitado', () => {
    render(<PasswordInput aria-label="Senha" disabled />);
    expect(screen.getByRole('button', { name: 'Mostrar senha' })).toBeDisabled();
  });
});
