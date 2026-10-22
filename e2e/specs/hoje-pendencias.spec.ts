/**
 * Aurora — pendências da reunião de 16/10/2026 na tela Hoje.
 *
 * Os dois painéis de espera (orçamento aguardando aprovação, equipamento
 * aguardando peça) e o filtro de cliente do gestor da plataforma.
 */
import { test, expect, E2E } from '../fixtures/aurora';

test.describe('Hoje · pendências de espera e filtro de cliente', () => {
  test('mostra os painéis de orçamento aguardando aprovação e de peças', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('Orçamentos aguardando aprovação')).toBeVisible();
    await expect(page.getByText('Equipamentos aguardando peças')).toBeVisible();
    await expect(page.getByRole('link', { name: /Ver orçamentos/ })).toBeVisible();
  });

  test('o seletor de cliente (com mais de um cliente) manda ?customer= ao quadro, à fila e à agenda', async ({
    comoCoordenadorA: page,
  }) => {
    // A massa tem um cliente só por organização, e com um cliente só o seletor nem
    // aparece (de propósito). Aqui a lista de clientes é simulada com dois, para
    // provar a fiação; o filtro no servidor tem teste próprio no banco.
    const outro = '0193d900-0003-7000-8000-0000000000ff';
    await page.route(/\/v1\/customers(\?.*)?$/, (route) =>
      route.fulfill({
        contentType: 'application/json',
        json: {
          single_customer: false,
          items: [
            { id: E2E.clienteA, name: 'Hospital Alfa' },
            { id: outro, name: 'Clínica Beta' },
          ],
        },
      })
    );

    const visto = new Set<string>();
    page.on('request', (r) => {
      const m =
        /\/v1\/(work-orders\/board|service-requests\/queue|schedule\/buckets)\?.*customer=([\w-]+)/.exec(
          r.url()
        );
      if (m && m[2] === outro) visto.add(m[1]!);
    });

    await page.goto('/');
    const seletor = page.getByLabel('Cliente');
    await expect(seletor).toBeVisible();
    await seletor.selectOption(outro);

    await expect
      .poll(() => [...visto].sort())
      .toEqual(['schedule/buckets', 'service-requests/queue', 'work-orders/board']);
    // Sem erro de tela: o painel de espera segue de pé com o cliente filtrado.
    await expect(page.getByText('Equipamentos aguardando peças')).toBeVisible();
  });
});
