/**
 * Aurora — "Nova automação" no navegador (reunião 16/10/2026, Fase 10).
 *
 * Roda na organização B: a A guarda o teste do "vazio" de automacoes.spec.
 * Lembrete e 5W2H criados pela tela, ligados, executados agora; a tarefa
 * aparece em /tarefas para o responsável e some para a outra organização.
 */
import { test, expect } from '../fixtures/aurora';

const TAREFA = 'Revisar filtros (5W2H e2e B)';

test.describe('Fase 10 · automações agendadas', () => {
  test('lembrete: cria pela tela, liga, mostra a agenda e executa agora', async ({
    comoCoordenadorB: page,
  }) => {
    await page.goto('/configuracoes/automacoes');
    await page.getByRole('button', { name: 'Nova automação' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Nova automação' });
    await dialogo.getByRole('radio', { name: /Lembrete/ }).check();
    await dialogo.getByLabel('Nome da automação').fill('Lembrete semanal e2e');
    await dialogo.getByLabel('Título').fill('Conferir carrinho de emergência');
    await dialogo
      .getByRole('group', { name: 'Destinatários' })
      .getByRole('checkbox', { name: 'Bruno do Beta' })
      .check();
    await expect(dialogo.getByRole('note')).toContainText('fica na fila');
    await dialogo.getByRole('button', { name: 'Criar automação' }).click();
    await expect(page.getByText('Automação criada e ligada')).toBeVisible();

    const item = page.getByRole('listitem').filter({ hasText: 'Lembrete semanal e2e' });
    await expect(item).toContainText('toda seg às 08:00');
    await expect(item).toContainText('Ligada');
    await item.getByRole('button', { name: 'Executar agora' }).click();
    await expect(page.getByText(/lembrete\(s\)/)).toBeVisible();
  });

  test('5W2H: a tarefa chega em /tarefas e é concluída pelo responsável', async ({
    comoCoordenadorB: page,
  }) => {
    await page.goto('/configuracoes/automacoes');
    await page.getByRole('button', { name: 'Nova automação' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Nova automação' });
    await dialogo.getByRole('radio', { name: /5W2H/ }).check();
    await dialogo.getByLabel('Nome da automação').fill('Plano 5W2H e2e');
    await dialogo.getByLabel('Periodicidade').selectOption('monthly');
    await dialogo.getByLabel('O quê (What)').fill(TAREFA);
    await dialogo.getByLabel('Quem (Who)').selectOption({ label: 'Bruno do Beta' });
    await dialogo.getByLabel('Por quê (Why)').fill('Achado de auditoria');
    await dialogo.getByLabel('Onde (Where)').fill('UTI');
    await dialogo.getByLabel('Como (How)').fill('Checklist do fabricante');
    await dialogo.getByLabel('Quanto (How much, R$)').fill('1500,00');
    await dialogo.getByRole('button', { name: 'Criar automação' }).click();
    await expect(page.getByText('Automação criada e ligada')).toBeVisible();

    const item = page.getByRole('listitem').filter({ hasText: 'Plano 5W2H e2e' });
    await expect(item).toContainText('todo dia 1 às 08:00');
    await item.getByRole('button', { name: 'Executar agora' }).click();
    await expect(page.getByText('tarefa 5w2h criada')).toBeVisible();

    await page.getByRole('link', { name: 'Tarefas' }).click();
    const tarefa = page.getByRole('listitem').filter({ hasText: TAREFA });
    await expect(tarefa).toContainText('UTI');
    await expect(tarefa).toContainText('R$');
    await tarefa.getByRole('button', { name: 'Concluir' }).click();
    await expect(tarefa).toContainText('Concluída');
  });

  test('a outra organização não vê as tarefas nem as regras de B', async ({ comoCoordenadorA: page }) => {
    await page.goto('/tarefas');
    await page.getByLabel('Ver as de toda a equipe').check();
    await expect(page.getByText('Nenhuma tarefa').or(page.getByRole('listitem').first())).toBeVisible();
    await expect(page.getByText(TAREFA)).toHaveCount(0);
  });
});
