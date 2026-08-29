/**
 * Aurora — design system: o que precisa ser verdade em toda tela.
 *
 * Os testes aqui não conferem aparência. Conferem as PROMESSAS: que o botão
 * não envia formulário por acidente, que o campo com erro é anunciado, que o
 * estado não depende de cor, que o foco volta para onde estava. São as coisas
 * que quebram em silêncio e que ninguém percebe olhando a tela.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  Button,
  Field,
  Input,
  StatusChip,
  CountBadge,
  Progress,
  EmptyState,
  SkeletonList,
  Breadcrumbs,
  Avatar,
  Tabs,
  Dialog,
  ToastProvider,
  useToast,
  CommandPalette,
} from '../index';

describe('Button', () => {
  it('não envia o formulário por acidente — o padrão do HTML é submit', async () => {
    const enviar = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={enviar}>
        <Button>Cancelar</Button>
      </form>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    // É o bug mais comum de formulário em React, e ele custa dados do usuário.
    expect(enviar).not.toHaveBeenCalled();
  });

  it('envia quando é explicitamente de envio', async () => {
    const enviar = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={enviar}>
        <Button type="submit">Salvar</Button>
      </form>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(enviar).toHaveBeenCalledOnce();
  });

  it('carregando ignora o clique mas CONTINUA focável e anunciado', async () => {
    const clicar = vi.fn();
    render(
      <Button loading onClick={clicar}>
        Salvar
      </Button>
    );

    const botao = screen.getByRole('button', { name: 'Salvar' });
    await userEvent.click(botao);
    expect(clicar).not.toHaveBeenCalled();

    // Desabilitar tiraria o botão da tabulação e o leitor de tela pararia de
    // anunciá-lo: quem apertou "Salvar" perderia o foco sem saber o que houve.
    expect(botao).not.toBeDisabled();
    expect(botao).toHaveAttribute('aria-busy', 'true');
    botao.focus();
    expect(botao).toHaveFocus();
  });

  it('desabilitado de verdade não recebe clique', async () => {
    const clicar = vi.fn();
    render(
      <Button disabled onClick={clicar}>
        Fechar OS
      </Button>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fechar OS' }));
    expect(clicar).not.toHaveBeenCalled();
  });

  it('botão só de ícone tem nome acessível', () => {
    render(<Button aria-label="Abrir menu de ações" icon={<span />} />);
    expect(screen.getByRole('button', { name: 'Abrir menu de ações' })).toBeInTheDocument();
  });
});

describe('Field', () => {
  it('o rótulo aponta para o controle: clicar no rótulo foca o campo', async () => {
    render(
      <Field label="Título da OS">
        <Input />
      </Field>
    );
    await userEvent.click(screen.getByText('Título da OS'));
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('a dica é LIDA, não só mostrada', () => {
    render(
      <Field label="Patrimônio" hint="Como está na etiqueta do equipamento.">
        <Input />
      </Field>
    );
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Como está na etiqueta do equipamento.');
  });

  it('o erro marca o campo como inválido e vira alerta', () => {
    render(
      <Field label="E-mail" error="Informe um endereço válido.">
        <Input />
      </Field>
    );

    const campo = screen.getByRole('textbox');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    // `role="alert"` chega a quem já saiu do campo — e a quem não vê a tela.
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um endereço válido.');
    expect(campo).toHaveAccessibleDescription(/Informe um endereço válido/);
  });

  it('obrigatório é dito por texto, não só por asterisco', () => {
    render(
      <Field label="Cliente" required>
        <Input />
      </Field>
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('(obrigatório)')).toBeInTheDocument();
  });

  it('rótulo escondido continua sendo o nome acessível', () => {
    render(
      <Field label="Buscar" labelHidden>
        <Input />
      </Field>
    );
    expect(screen.getByRole('textbox', { name: 'Buscar' })).toBeInTheDocument();
  });
});

describe('estado nunca é só cor (WCAG 1.4.1)', () => {
  it('o chip carrega o texto do estado', () => {
    render(<StatusChip tone="bad">SLA estourado</StatusChip>);
    expect(screen.getByText('SLA estourado')).toBeInTheDocument();
  });

  it('a explicação do estado chega ao leitor de tela', () => {
    render(
      <StatusChip tone="warn" hint="Vence em 2 horas">
        Em risco
      </StatusChip>
    );
    expect(screen.getByText(/Vence em 2 horas/)).toBeInTheDocument();
  });

  it('o contador diz o que está contando', () => {
    render(<CountBadge count={3} label="notificação não lida" />);
    expect(screen.getByLabelText('3 notificação não lidas')).toBeInTheDocument();
  });

  it('contador zerado não aparece — "0" é ruído', () => {
    const { container } = render(<CountBadge count={0} label="notificação" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('acima do teto mostra 99+ mas anuncia o número real', () => {
    render(<CountBadge count={1284} label="pendência" />);
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByLabelText('1284 pendências')).toBeInTheDocument();
  });

  it('a barra de progresso vem com número — barra sozinha é estimativa', () => {
    render(<Progress value={97} label="Consumo do SLA" />);
    const barra = screen.getByRole('progressbar', { name: 'Consumo do SLA' });
    expect(barra).toHaveAttribute('aria-valuenow', '97');
    expect(screen.getByText('97%')).toBeInTheDocument();
  });
});

describe('vazio e espera', () => {
  it('o vazio diz o que houve e oferece saída', () => {
    render(
      <EmptyState
        title="Nenhuma ordem de serviço"
        description="Ainda não há OS nesta organização."
        action={<Button variant="primary">Criar a primeira</Button>}
      />
    );
    expect(screen.getByText('Nenhuma ordem de serviço')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar a primeira' })).toBeInTheDocument();
  });

  it('vazio POR FILTRO diz que é por filtro — a ação é outra', () => {
    render(<EmptyState title="Nenhum resultado" filtered />);
    expect(screen.getByText(/corresponde aos filtros/)).toBeInTheDocument();
  });

  it('a espera é anunciada uma vez, não uma por linha', () => {
    render(<SkeletonList rows={8} label="ordens de serviço" />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando ordens de serviço…');
  });
});

describe('navegação', () => {
  it('a trilha marca a página atual e não a transforma em link', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Hospital Central', href: '/c/1' },
          { label: 'UTI', href: '/c/1/uti' },
          { label: 'Ventilador A1' },
        ]}
      />
    );

    const trilha = screen.getByRole('navigation', { name: 'Trilha de navegação' });
    expect(within(trilha).getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('Ventilador A1')).toHaveAttribute('aria-current', 'page');
  });

  it('o avatar leva o nome completo — iniciais se repetem em toda equipe', () => {
    render(<Avatar name="Rafael Souza" />);
    expect(screen.getByRole('img', { name: 'Rafael Souza' })).toBeInTheDocument();
    expect(screen.getByText('RS')).toBeInTheDocument();
  });

  it('as abas andam com as setas e circulam na ponta', async () => {
    function Exemplo() {
      const [v, setV] = useState('todas');
      return (
        <Tabs
          aria-label="Situação"
          value={v}
          onChange={setV}
          items={[
            { id: 'todas', label: 'Todas', count: 42 },
            { id: 'minhas', label: 'Minhas', count: 7 },
            { id: 'atrasadas', label: 'Atrasadas', count: 3 },
          ]}
        />
      );
    }
    render(<Exemplo />);

    const primeira = screen.getByRole('tab', { name: /Todas/ });
    primeira.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Minhas/ })).toHaveAttribute('aria-selected', 'true');

    // Da primeira para trás, chega na última: parar na ponta faz a pessoa
    // achar que o teclado travou.
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: /Atrasadas/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Dialog', () => {
  function Exemplo() {
    const [aberto, setAberto] = useState(false);
    return (
      <>
        <Button onClick={() => setAberto(true)}>Atribuir</Button>
        <Dialog
          open={aberto}
          onOpenChange={setAberto}
          title="Atribuir ordem de serviço"
          description="Escolha quem vai executar. A pessoa recebe uma notificação."
        >
          <p>corpo</p>
        </Dialog>
      </>
    );
  }

  it('é anunciado com título e descrição', async () => {
    render(<Exemplo />);
    await userEvent.click(screen.getByRole('button', { name: 'Atribuir' }));

    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveAccessibleName('Atribuir ordem de serviço');
    expect(dialogo).toHaveAccessibleDescription(/Escolha quem vai executar/);
  });

  it('Escape fecha e o foco volta para quem abriu', async () => {
    render(<Exemplo />);
    const gatilho = screen.getByRole('button', { name: 'Atribuir' });
    await userEvent.click(gatilho);
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Sem isto, quem navega por teclado volta para o começo da página. A
    // devolução do foco acontece depois da desmontagem, então é esperada.
    await waitFor(() => expect(gatilho).toHaveFocus());
  });
});

describe('avisos', () => {
  function Exemplo() {
    const toast = useToast();
    return (
      <>
        <Button onClick={() => toast.success('OS 1042 atribuída', 'Rafael Souza foi notificado.')}>
          sucesso
        </Button>
        <Button onClick={() => toast.error('Não foi possível atribuir')}>erro</Button>
      </>
    );
  }

  it('confirma o que aconteceu, com o detalhe que identifica o registro', async () => {
    render(
      <ToastProvider>
        <Exemplo />
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'sucesso' }));

    expect(await screen.findByText('OS 1042 atribuída')).toBeInTheDocument();
    expect(screen.getByText('Rafael Souza foi notificado.')).toBeInTheDocument();
  });

  it('o sucesso sai sozinho depois do tempo', async () => {
    /*
     * 300ms, E NÃO 40 — e a diferença é entre um teste e um teste instável.
     *
     * Com 40ms, a asserção de que o aviso APARECEU corria contra o próprio
     * relógio que o faz sumir: numa máquina carregada, tratar o clique e
     * renderizar leva mais que isso, e o aviso já tinha ido embora quando a
     * linha seguinte olhava. Passava quase sempre — e "quase sempre" é o pior
     * resultado possível, porque ensina a reexecutar em vez de investigar.
     *
     * 300ms dá folga de uma ordem de grandeza para o agendamento do sistema
     * operacional, e o `waitFor` continua terminando em menos de meio segundo.
     */
    render(
      <ToastProvider autoDismissMs={300}>
        <Exemplo />
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'sucesso' }));
    expect(screen.getByText('OS 1042 atribuída')).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText('OS 1042 atribuída')).not.toBeInTheDocument());
  });

  it('o erro NÃO desaparece sozinho, mesmo passado o tempo do sucesso', async () => {
    // Mesma folga do caso acima, e pela mesma razão.
    render(
      <ToastProvider autoDismissMs={300}>
        <Exemplo />
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'erro' }));
    await userEvent.click(screen.getByRole('button', { name: 'sucesso' }));

    // O sucesso some; o erro fica. Um erro que evapora é um erro que ninguém
    // corrige — e a WCAG 2.2 (2.2.1) não aceita limite de tempo que a pessoa
    // não controla.
    await waitFor(() => expect(screen.queryByText('OS 1042 atribuída')).not.toBeInTheDocument());
    expect(screen.getByText('Não foi possível atribuir')).toBeInTheDocument();
  });

  it('dá para fechar, e o botão diz qual aviso fecha', async () => {
    render(
      <ToastProvider>
        <Exemplo />
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'erro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar aviso: Não foi possível atribuir' }));
    expect(screen.queryByText('Não foi possível atribuir')).not.toBeInTheDocument();
  });
});

describe('CommandPalette', () => {
  function Exemplo({ items = [] as { id: string; label: string; group: string }[] }) {
    const [aberto, setAberto] = useState(true);
    const [q, setQ] = useState('');
    return (
      <CommandPalette
        open={aberto}
        onOpenChange={setAberto}
        query={q}
        onQueryChange={setQ}
        items={items.map((i) => ({ ...i, onSelect: () => undefined }))}
      />
    );
  }

  it('abre com o foco no campo — quem abre a paleta quer digitar', async () => {
    render(<Exemplo />);
    expect(await screen.findByRole('combobox')).toHaveFocus();
  });

  it('sem nada digitado, ensina o que dá para buscar', async () => {
    render(<Exemplo />);
    expect(await screen.findByText(/patrimônio, TAG, série/)).toBeInTheDocument();
  });

  it('a seta desce e o resultado destacado é ANUNCIADO', async () => {
    render(
      <Exemplo
        items={[
          { id: 'a', label: 'OS 1042 — Ventilador A1', group: 'Ordens de serviço' },
          { id: 'b', label: 'OS 1043 — Monitor B2', group: 'Ordens de serviço' },
        ]}
      />
    );

    const campo = await screen.findByRole('combobox');
    await userEvent.type(campo, 'os');
    await userEvent.keyboard('{ArrowDown}');

    // `aria-activedescendant` é o que faz o leitor de tela ler o item
    // destacado sem tirar o foco do campo de busca.
    expect(campo.getAttribute('aria-activedescendant')).toMatch(/-b$/);
    expect(screen.getByRole('option', { name: /Monitor B2/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('nada encontrado explica o que a busca cobre', async () => {
    render(<Exemplo items={[]} />);
    await userEvent.type(await screen.findByRole('combobox'), 'xyz');
    expect(screen.getByText(/Nada encontrado para “xyz”/)).toBeInTheDocument();
    expect(screen.getByText(/dentro do que você tem permissão para ver/)).toBeInTheDocument();
  });
});
