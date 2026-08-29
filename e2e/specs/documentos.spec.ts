/**
 * Aurora — documentos técnicos, no navegador (EPIC-018).
 *
 * A massa não tem documento emitido, e é assim de propósito: documento nasce
 * de emissão, com verificação do que falta antes. Semeá-lo por escrita direta
 * produziria um estado que a aplicação não sabe criar.
 *
 * O que este arquivo prova é a TELA: o recorte de vencimento, o vazio
 * explicado, e a distinção entre "sem validade" e "não existe" — que é a que
 * faria metade do acervo sumir se fosse colapsada.
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

test.describe('EPIC-018 · documentos', () => {
  test('abre no que vence, e explica por que o acervo pode ter mais', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/documentos');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Documentos');

    await expect(page.getByRole('tab', { name: /Vencendo/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    /*
     * O VAZIO É EXPLICADO, e a explicação diz a distinção que importa:
     * documento sem validade não vence, e por isso não entra neste recorte —
     * mas está no acervo. Colapsar os dois faria sumir da tela metade do que a
     * organização tem, e ninguém notaria.
     */
    await expect(page.getByText(/Nada vence nos próximos 60 dias/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/sem data de validade não entram neste recorte/)).toBeVisible();
  });

  test('o alternador leva de ativos a documentos sob o mesmo item de menu', async ({
    comoCoordenadorA: page,
  }) => {
    // Laudo é sobre EQUIPAMENTO: a pergunta "cadê o laudo?" nasce olhando o
    // equipamento, e por isso os dois dividem o item.
    await page.goto('/ativos');
    await page
      .getByRole('navigation', { name: 'Ativos e documentos' })
      .getByRole('link', { name: 'Documentos' })
      .click();

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Documentos');
    expect(page.url()).toContain('/documentos');
  });

  test('o recorte de vencimento é do SERVIDOR, e ignora quem não tem validade', async ({
    comoCoordenadorA: page,
  }) => {
    /*
     * A prova é da API, e não da tela: um filtro aplicado no navegador teria
     * recebido tudo antes de filtrar, e a lista de 500 seria uma lista de
     * cinco mil truncada em silêncio.
     */
    const comRecorte = await page.request.get(`${apiUrl()}/documents?expiring_within_days=60`, {
      headers: cab,
    });
    expect(comRecorte.ok()).toBe(true);
    const { items } = await comRecorte.json();

    // Todo item do recorte TEM validade: sem ela, não há o que vencer.
    for (const d of items) {
      expect(d.valid_until, `${d.id} entrou no recorte sem validade`).not.toBeNull();
    }

    // E um recorte de zero dias não pode devolver mais do que um de 3650.
    const zero = await page.request.get(`${apiUrl()}/documents?expiring_within_days=0`, {
      headers: cab,
    });
    const dezAnos = await page.request.get(`${apiUrl()}/documents?expiring_within_days=3650`, {
      headers: cab,
    });
    expect((await zero.json()).items.length).toBeLessThanOrEqual(
      (await dezAnos.json()).items.length
    );
  });

  test('janela inválida é recusada', async ({ comoCoordenadorA: page }) => {
    for (const v of ['-1', '99999', 'ontem']) {
      const r = await page.request.get(`${apiUrl()}/documents?expiring_within_days=${v}`, {
        headers: cab,
      });
      expect(r.status(), v).toBe(422);
    }
  });
});
