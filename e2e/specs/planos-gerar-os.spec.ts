/**
 * Aurora — "Gerar OS deste ciclo" (vídeo do Anderson, 13/11/2026).
 *
 * Plano SEM geração automática, com um procedimento diferente por equipamento: o ciclo abre, nenhuma
 * OS nasce sozinha, e o botão da página do plano gera a OS de cada equipamento com o checklist DELE
 * (e o adicional, quando há). Ao fim, o teste cancela as OS e desliga o plano.
 */
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

test('o botão gera a OS de cada equipamento com o procedimento dele', async ({ comoCoordenadorA: page }) => {
  const marca = Date.now() % 1_000_000;
  const get = async (caminho: string) =>
    (await page.request.get(`${apiUrl()}${caminho}`, { headers: cab })).json();
  const post = async (caminho: string, data: unknown) => {
    const r = await page.request.post(`${apiUrl()}${caminho}`, { headers: cab, data });
    expect(r.status(), `${caminho}: ${await r.text()}`).toBeLessThan(300);
    return r.json();
  };

  // Três procedimentos de preventiva, cada um com o seu título.
  const titulos = {
    vent: `Ventilador E2E ${marca}`,
    mon: `Monitor E2E ${marca}`,
    extra: `Adicional E2E ${marca}`,
  };
  for (const title of Object.values(titulos)) {
    await post('/checklist-templates', {
      title,
      items: [{ kind: 'boolean', label: 'Funciona?' }],
      publish: true,
    });
  }
  const { templates } = await get('/maintenance-plans/form-options');
  const chave = (t: string) => templates.find((x: { title: string }) => x.title === t).key as string;

  const { locations } = await get(`/customers/${E2E.clienteA}`);
  const setor = locations.find((l: { name: string }) => l.name === 'UTI Alfa').id as string;
  const { items: ativos } = await get(`/assets?customer=${E2E.clienteA}&location=${setor}&limit=100`);
  const ativo = (n: string) => ativos.find((a: { name: string }) => a.name === n).id as string;

  const plano = await post('/maintenance-plans', {
    name: `Plano manual E2E ${marca}`,
    customer_id: E2E.clienteA,
    sector_id: setor,
    kind: 'preventive',
    items: [
      {
        asset_id: ativo('Ventilador Alfa-1'),
        checklist_template_key: chave(titulos.vent),
        extra_checklist_template_keys: [chave(titulos.extra)],
      },
      { asset_id: ativo('Monitor Alfa-2'), checklist_template_key: chave(titulos.mon) },
    ],
    frequency_unit: 'semester',
    frequency_interval: 1,
    anchor_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
    lead_time_days: 0,
    tolerance_days: 5,
    auto_generate: false,
  });
  // Plano manual: o ciclo abre, e nenhuma OS nasce sozinha.
  expect(plano).toMatchObject({ task_count: 2, cycles_opened: 2, work_orders: 0 });

  const geradas: string[] = [];
  try {
    await page.goto(`/planos/${plano.id}`);
    for (const [nome, esperados] of [
      ['Ventilador Alfa-1', [titulos.extra, titulos.vent]],
      ['Monitor Alfa-2', [titulos.mon]],
    ] as const) {
      const cartao = page.getByLabel(`Equipamento do plano: ${nome}`);
      await cartao.getByRole('button', { name: 'Gerar OS deste ciclo (1)' }).click();
      // Gerada, não há o que gerar de novo: o botão sai.
      await expect(cartao.getByRole('button', { name: /Gerar OS deste ciclo/ })).toHaveCount(0, {
        timeout: 15_000,
      });

      const { items } = await get(`/work-orders?asset=${ativo(nome)}&limit=100`);
      const os = items.find((o: { title: string }) => o.title.includes(`Plano manual E2E ${marca}`));
      expect(os, `OS de ${nome}`).toBeTruthy();
      geradas.push(os.id);
      const { items: checklists } = await get(`/work-orders/${os.id}/checklists`);
      expect(checklists.map((x: { template_title: string }) => x.template_title).sort()).toEqual(
        [...esperados].sort()
      );
    }
    expect(new Set(geradas).size).toBe(2);
  } finally {
    for (const id of geradas) {
      await page.request.post(`${apiUrl()}/work-orders/${id}/transitions`, {
        headers: cab,
        data: { to: 'cancelled', cancellation_reason: 'Encerramento do teste ponta a ponta.' },
      });
    }
    await page.request.post(`${apiUrl()}/maintenance-plans/${plano.id}/deactivate`, {
      headers: cab,
      data: { reason: 'Encerramento do teste ponta a ponta' },
    });
  }
});
