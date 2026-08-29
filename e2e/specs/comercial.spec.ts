/**
 * Aurora — contratos e orçamentos, no navegador (EPIC-016, EPIC-017).
 *
 * A massa tem um contrato cobrindo o SETOR, e um ativo dentro de um LEITO
 * abaixo dele. É esse arranjo que distingue "a cobertura alcança a subárvore"
 * de "a cobertura alcança o local exato" — com um ativo só, no local exato, os
 * dois comportamentos dariam o mesmo resultado e o teste não provaria nada.
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

test.describe('EPIC-017 · contratos', () => {
  test('a cobertura é expressão, e a tela mostra o que ela alcança HOJE', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/contratos');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Contratos');
    await expect(page.getByRole('link', { name: /Manutenção integral Alfa/ })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('link', { name: /Manutenção integral Alfa/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Manutenção integral');

    // Duas coisas separadas: a expressão, e a lista que ela produz agora.
    await expect(page.getByText('O local e tudo que está dentro dele')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Ativos cobertos hoje')).toBeVisible();

    /*
     * O VENTILADOR está no setor coberto; o MONITOR está num leito DENTRO
     * dele. Os dois têm de aparecer.
     *
     * Se só o ventilador aparecesse, a cobertura estaria comparando o local
     * exato em vez da subárvore — e o sintoma no uso real seria um contrato
     * que parece cobrir uma unidade inteira e deixa de fora tudo que está nas
     * salas.
     */
    await expect(page.getByRole('link', { name: /Ventilador Alfa-1/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Monitor Alfa-2/ })).toBeVisible();
  });

  test('sem permissão financeira, o valor do contrato não sai do servidor', async ({
    comoCoordenadorA: page,
  }) => {
    const lista = await page.request.get(`${apiUrl()}/contracts`, { headers: cab });
    const { items } = await lista.json();
    const contrato = items[0];

    // A auditora lê contrato e não lê valores.
    const daAuditoria = await page.request.get(`${apiUrl()}/contracts/${contrato.id}`, {
      headers: {
        authorization: `Bearer local:${E2E.emailAuditora}:${E2E.emailAuditora}`,
        'x-aurora-organization': E2E.orgA,
      },
    });

    if (daAuditoria.ok()) {
      const corpo = await daAuditoria.json();
      expect(corpo.contract.monthly_value).toBeNull();
      expect(corpo.contract.overage_hour_rate).toBeNull();
      expect(JSON.stringify(corpo.contract)).not.toContain('12000');
      // A COBERTURA continua visível: é o que decide se o atendimento está no
      // escopo, e negá-la impediria o trabalho em vez de proteger o valor.
      expect(Array.isArray(corpo.coverages)).toBe(true);
      expect(corpo.coverages.length).toBeGreaterThan(0);
    } else {
      expect(daAuditoria.status()).toBe(403);
    }
  });
});

test.describe('EPIC-016 · orçamentos', () => {
  test('o alternador leva de contratos a orçamentos sob o mesmo item de menu', async ({
    comoCoordenadorA: page,
  }) => {
    // O menu tem oito itens por decisão escrita em `shell/navigation.ts`. O
    // alternador é o que evita um nono — e fica VISÍVEL, não escondido num
    // menu, para quem chegou pelo caminho de contrato descobrir que o outro
    // existe.
    await page.goto('/contratos');
    await page.getByRole('navigation', { name: 'Contratos e orçamentos' }).getByRole('link', { name: 'Orçamentos' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Orçamentos');
    expect(page.url()).toContain('/orcamentos');
  });

  test('a ficha mostra a versão atual e a linha do tempo das versões', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/orcamentos');
    const primeiro = page.getByRole('link', { name: /QT-/ }).first();
    await expect(primeiro).toBeVisible({ timeout: 15_000 });
    await primeiro.click();

    // Revisar não sobrescreve: cria versão nova. A linha do tempo é o que
    // permite responder "o que exatamente foi acordado?" sem depender de
    // anexo em e-mail.
    await expect(page.getByText('Versões')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('atual')).toBeVisible();
  });
});
