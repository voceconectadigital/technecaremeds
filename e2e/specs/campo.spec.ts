/**
 * Aurora — o aplicativo de campo, no modo avião (EPIC-014 · SPEC §20).
 *
 * ESTE ARQUIVO RODA NUM PIXEL 7, E DESLIGA A REDE DE VERDADE.
 *
 * `context.setOffline(true)` corta a rede no nível do navegador: `fetch` falha,
 * `navigator.onLine` vira falso, e a página se comporta como no subsolo de um
 * hospital. É a diferença entre testar o comportamento offline e testar um
 * simulador dele.
 *
 * O CRITÉRIO DE ACEITE DO ÉPICO É UMA FRASE: "executar e concluir uma OS
 * completa em modo avião, sincronizando depois sem intervenção". O teste
 * central deste arquivo é essa frase, passo a passo, com a prova final vindo do
 * SERVIDOR — e não da tela, que mostraria o que quer que o cliente tenha
 * guardado.
 *
 * AS PERGUNTAS AO SERVIDOR USAM UM CLIENTE À PARTE (`request`), e não
 * `page.request`.
 *
 * `page.request` compartilha o contexto do navegador, e `setOffline(true)`
 * derruba os dois juntos. Perguntar por ali durante o modo avião não devolve "o
 * servidor não tem nada": devolve uma requisição que morreu na saída — o que é
 * indistinguível de tudo o mais e não prova coisa nenhuma.
 *
 * O cliente separado continua alcançando a API, que é justamente o que permite
 * encenar o mundo lá fora seguindo em frente enquanto o técnico está sem sinal.
 */
import { test as base, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { E2E, apiUrl } from '../fixtures/aurora';

const test = base.extend<{ comoTecnico: Page }>({
  comoTecnico: async ({ page }, use) => {
    await page.addInitScript(
      ({ email, org }) => {
        /*
         * O `try` NÃO é zelo excessivo.
         *
         * `addInitScript` roda em TODO documento, inclusive no `about:blank`
         * que o navegador cria antes da primeira navegação — e ali o acesso ao
         * armazenamento é negado. A exceção não atrapalha o teste, mas chega
         * como erro não capturado na página, e a vigilância de console desta
         * suíte a reprovaria: uma falha do arranjo com cara de defeito do
         * produto.
         */
        try {
          localStorage.setItem('aurora:token', `local:${email}:${email}`);
          localStorage.setItem('aurora:organizacao', org);
        } catch {
          /* about:blank, ou armazenamento bloqueado. A navegação seguinte grava. */
        }
      },
      { email: E2E.emailTecA, org: E2E.orgA }
    );

    const erros: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') erros.push(m.text());
    });
    page.on('pageerror', (e) => erros.push(`exceção não capturada: ${e.message}`));

    toleradosNesteTeste = [];
    await use(page);

    /*
     * O NAVEGADOR RECLAMANDO É FALHA — com UMA classe de exceção, e ela é o
     * ponto deste aplicativo.
     *
     * Um `fetch` que falha com a rede desligada aparece no console como erro,
     * e é EXATAMENTE o comportamento correto: a fila tentou, não conseguiu, e
     * guardou. Exigir console limpo aqui faria o teste reprovar o sucesso.
     *
     * Qualquer OUTRA reclamação continua sendo falha — inclusive um 4xx, que
     * é o que um teste tolera nomeadamente com `tolera()` quando o provoca de
     * propósito.
     */
    /*
     * A lista é FECHADA, e cada entrada é uma forma que o navegador tem de
     * dizer "sem rede". `ERR_FAILED` é a que o carregador de recursos usa —
     * genérica o bastante para incomodar, e por isso mesmo não vale ampliar o
     * filtro para "qualquer erro de rede": um `fetch` para uma rota que não
     * existe também falha, e esse é defeito nosso.
     */
    const daRedeDesligada =
      /Failed to fetch|net::ERR_INTERNET_DISCONNECTED|net::ERR_NETWORK_CHANGED|net::ERR_FAILED/i;
    const inesperados = erros.filter(
      (e) => !daRedeDesligada.test(e) && !toleradosNesteTeste.some((r) => r.test(e))
    );
    expect(inesperados, 'o navegador reclamou de algo que não é a rede desligada').toEqual([]);
  },
});

/**
 * O que ESTE teste provoca de propósito.
 *
 * Zerado a cada caso pela fixture. A versão preguiçosa disto — ignorar todo
 * 4xx — engoliria calada a próxima recusa legítima que aparecesse por engano.
 * Quem tolera, tolera uma coisa só, e escreve qual.
 */
let toleradosNesteTeste: RegExp[] = [];

const cabDoTecnico = {
  authorization: `Bearer local:${E2E.emailTecA}:${E2E.emailTecA}`,
  'x-aurora-organization': E2E.orgA,
};

/** Espera o pacote do dia estar no aparelho — e não um tempo arbitrário. */
async function sincronizado(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Hoje' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/sincronizados há|sincronizados agora/)).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('CAMPO · o dia cabe no aparelho', () => {
  test('a primeira sincronização traz as ordens, e elas continuam ali sem rede', async ({
    comoTecnico: page,
    context,
  }) => {
    await page.goto('/');
    await sincronizado(page);

    // Passo 1 · com rede, o dia chega.
    await expect(page.getByText('Ventilador não pressuriza')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Monitor com alarme intermitente')).toBeVisible();

    // Passo 2 · MODO AVIÃO.
    await context.setOffline(true);

    // Passo 3 · recarregar sem rede, e a lista continua lá.
    //
    // É a prova de que a tela lê do APARELHO, e não de um cache de memória que
    // morre no recarregamento. Sem isso, "funciona offline" duraria até a
    // primeira vez que o sistema operacional recuperasse memória.
    await page.reload();
    await expect(page.getByText('Ventilador não pressuriza')).toBeVisible({ timeout: 20_000 });

    // Passo 4 · e a tela DIZ que está sem rede, em vez de fingir.
    await expect(page.getByText('sem rede')).toBeVisible();

    await context.setOffline(false);
  });
});

test.describe('CAMPO · executar em modo avião', () => {
  test('o trabalho feito sem rede chega ao servidor quando o sinal volta, sem ninguém pedir', async ({
    comoTecnico: page,
    context,
    request,
  }) => {
    /*
     * O CRITÉRIO DE ACEITE, PASSO A PASSO.
     *
     * A prova final é do SERVIDOR: perguntar à tela se deu certo é perguntar ao
     * cliente sobre o próprio otimismo. A pergunta que importa é se o
     * apontamento existe no banco.
     */
    await page.goto('/');
    await sincronizado(page);

    /*
     * Passo 5 · a ordem alvo é identificada AGORA, com rede.
     *
     * Perguntar depois exigiria rede no meio do modo avião, e é exatamente o
     * que não pode existir aqui.
     */
    const listaAntes = await request.get(`${apiUrl()}/work-orders?assignee=${E2E.memTecA}`, {
      headers: cabDoTecnico,
    });
    const { items: ordensAntes } = await listaAntes.json();
    const alvo = ordensAntes.find((o: { title: string }) => o.title === 'Ventilador não pressuriza');
    expect(alvo, 'a massa precisa da OS do ventilador atribuída ao técnico').toBeTruthy();

    // E o cronômetro dele ainda não existe: é o "antes" da medição.
    const horasAntes = await contarHoras(request, alvo.id);
    expect(horasAntes).toBe(0);

    await page.getByText('Ventilador não pressuriza').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ventilador não pressuriza');

    // Passo 6 · MODO AVIÃO. Daqui em diante, nada de rede.
    await context.setOffline(true);

    // Passo 7 · iniciar o cronômetro. O botão responde NA HORA.
    //
    // Um botão que espera resposta travaria aqui por trinta segundos e depois
    // falharia — e o que a pessoa fez naquele momento não existiria em lugar
    // nenhum.
    await page.getByRole('button', { name: 'Iniciar cronômetro' }).click();

    // Passo 8 · o indicador permanente conta o que está guardado.
    await expect(page.getByText(/(ação guardada|ações guardadas) no aparelho/)).toBeVisible({
      timeout: 15_000,
    });

    // Passo 9 · escrever o que foi feito, offline.
    const resolucao = 'Trocada a válvula de exalação; estanqueidade aprovada.';
    await page.getByLabel('O que foi feito').fill(resolucao);

    // Passo 10 · e a fila continua guardando enquanto ele trabalha.
    await expect(page.getByText(/(ação guardada|ações guardadas) no aparelho/)).toBeVisible();

    /*
     * Passo 11 · O SERVIDOR CONTINUA SEM NADA.
     *
     * É a prova de que o aparelho estava mesmo offline, e não de que a rede
     * estava lenta: o cronômetro foi iniciado há vários segundos e o banco não
     * tem apontamento nenhum.
     */
    expect(await contarHoras(request, alvo.id)).toBe(0);

    // Passo 12 · O SINAL VOLTA. Ninguém toca em nada.
    await context.setOffline(false);

    /*
     * Passo 13 · "sincronizando depois SEM INTERVENÇÃO".
     *
     * O aplicativo escuta o evento `online` e escoa sozinho. Tocar em
     * "sincronizar" aqui testaria o botão, e não a promessa.
     */
    await expect(page.getByText('tudo enviado')).toBeVisible({ timeout: 30_000 });

    /*
     * Passo 14 · A PROVA É DO SERVIDOR.
     *
     * O apontamento que o técnico iniciou no subsolo, sem rede, existe no
     * banco. Nada disto passou por uma tela dizendo que deu certo.
     */
    expect(await contarHoras(request, alvo.id)).toBe(1);

    /*
     * O CRONÔMETRO É PARADO AQUI, e não é limpeza cosmética.
     *
     * O banco admite UM cronômetro aberto por pessoa — é uma defesa do
     * domínio, e uma boa. Deixá-lo correndo faria o caso seguinte receber 409
     * ao iniciar o dele, e falhar por um motivo que não é o dele: o sintoma
     * apareceria como "a fila não esvaziou", que aponta para o lugar errado.
     *
     * E é também o que o técnico faz de verdade quando termina.
     */
    await pararCronometros(request, alvo.id);
  });

  test('reenviar não duplica: recarregar no meio do envio não cria dois apontamentos', async ({
    comoTecnico: page,
    context,
    request,
  }) => {
    /*
     * O caso que a idempotência do servidor existe para cobrir, encenado pelo
     * cliente: o aplicativo é recarregado enquanto a fila ainda tem coisa, e
     * tenta de novo. O identificador da operação é o mesmo — ele foi gravado
     * junto com o comando —, e o servidor devolve o desfecho da primeira vez.
     */
    await page.goto('/');
    await sincronizado(page);
    await page.getByText('Monitor com alarme intermitente').click();

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Iniciar cronômetro' }).click();
    await expect(page.getByText(/(ação guardada|ações guardadas) no aparelho/)).toBeVisible({
      timeout: 15_000,
    });

    // Recarrega ainda offline: a fila sobrevive ao recarregamento.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    await context.setOffline(false);
    await expect(page.getByText('tudo enviado')).toBeVisible({ timeout: 30_000 });

    // UM apontamento, e não dois: o identificador da operação sobreviveu ao
    // recarregamento, e o servidor reconheceu a retentativa como retentativa.
    const ordens = await request.get(`${apiUrl()}/work-orders?assignee=${E2E.memTecA}`, {
      headers: cabDoTecnico,
    });
    const { items } = await ordens.json();
    const monitor = items.find((o: { title: string }) => o.title.includes('Monitor'));
    expect(monitor).toBeTruthy();
    expect(await contarHoras(request, monitor.id)).toBe(1);
  });
});

test.describe('CAMPO · nada é descartado em silêncio', () => {
  test('a ordem cancelada durante o trabalho offline vira conflito visível, com o texto guardado', async ({
    comoTecnico: page,
    context,
    request,
  }) => {
    /*
     * O TERCEIRO CRITÉRIO DE ACEITE DO ÉPICO, encenado inteiro:
     *
     *   "OS cancelada no servidor durante execução offline gera conflito
     *    visível, com o trabalho do técnico preservado e recuperável."
     */
    await page.goto('/');
    await sincronizado(page);

    const ordens = await request.get(`${apiUrl()}/work-orders?assignee=${E2E.memTecA}`, {
      headers: cabDoTecnico,
    });
    const { items } = await ordens.json();
    const alvo = items.find((o: { title: string }) => o.title === 'Ventilador não pressuriza');
    expect(alvo).toBeTruthy();

    await page.getByText('Ventilador não pressuriza').click();

    // O técnico entra no subsolo e trabalha.
    await context.setOffline(true);
    const trabalho = 'Diagnóstico: célula de O2 saturada. Substituída e calibrada.';
    await page.getByLabel('O que foi feito').fill(trabalho);

    /*
     * Ele pede uma mudança de situação — qualquer uma que o grafo ofereça a
     * partir do estado atual. O botão exato não importa; o que importa é que o
     * comando entre na fila com o texto dele junto.
     */
    const acoes = page.getByRole('button').filter({ hasNotText: 'Iniciar cronômetro' });
    await acoes.last().click();
    await expect(page.getByText(/(ação guardada|ações guardadas) no aparelho/)).toBeVisible({
      timeout: 15_000,
    });

    /*
     * ENQUANTO ISSO, NO ESCRITÓRIO: a coordenação cancela a ordem.
     *
     * É aqui que o cliente à parte se paga: o mundo lá fora precisa seguir em
     * frente enquanto o aparelho do técnico está no modo avião, e com
     * `page.request` esta chamada morreria junto com ele.
     */
    await request.post(`${apiUrl()}/work-orders/${alvo.id}/transitions`, {
      headers: {
        authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
        'x-aurora-organization': E2E.orgA,
      },
      data: { to: 'cancelled', cancellation_reason: 'Equipamento devolvido ao fabricante.' },
    });

    /*
     * O 409 QUE VEM A SEGUIR É O PONTO DESTE TESTE.
     *
     * O servidor vai recusar a mudança de situação porque a ordem foi
     * cancelada — é exatamente o que se quer provar. Sem declarar isso, a
     * vigilância de console reprovaria o teste pelo sucesso dele.
     */
    toleradosNesteTeste.push(/status of 409/i);

    // O sinal volta no estacionamento.
    await context.setOffline(false);

    // E o trabalho aparece em "Precisa da sua atenção" — não some, não vira
    // erro passageiro, não é aplicado à força.
    await page.goto('/atencao');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Precisa da sua atenção');
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible({ timeout: 30_000 });

    // COM O TEXTO INTEIRO. Pedir que ele lembre o diagnóstico de duas horas
    // atrás é pedir uma versão pior do que ele escreveu.
    await expect(page.getByText(trabalho)).toBeVisible();

    // E a tela diz O QUE ACONTECEU, em português.
    await expect(page.getByText(/cancelada|não é possível|Não é possível/i).first()).toBeVisible();
  });

  test('a tela de atenção oferece as duas saídas, e o descarte pede confirmação', async ({
    comoTecnico: page,
    context,
    request,
  }) => {
    /*
     * ESTE CASO CRIA O PRÓPRIO CONFLITO, e a primeira versão não criava.
     *
     * Ela contava com o conflito deixado pelo caso anterior e pulava quando
     * não o encontrava — e nunca encontrava: cada teste roda em contexto
     * próprio, com IndexedDB próprio, e o que ficou guardado no aparelho de um
     * não existe no do outro. O resultado era um teste que aparecia como
     * "pulado" em toda execução, ou seja, um teste que não existe.
     *
     * Pular por falta de arranjo é sempre isso: a suíte fica verde afirmando
     * ter conferido algo que não conferiu.
     */
    const ordens = await request.get(`${apiUrl()}/work-orders?assignee=${E2E.memTecA}`, {
      headers: cabDoTecnico,
    });
    const { items } = await ordens.json();
    const alvo = items.find((o: { title: string }) => o.title.includes('Monitor'));
    expect(alvo, 'a massa precisa da OS do monitor atribuída ao técnico').toBeTruthy();

    await page.goto('/');
    await sincronizado(page);
    await page.getByText('Monitor com alarme intermitente').click();

    await context.setOffline(true);
    await page.getByLabel('O que foi feito').fill('Ajustado o limiar do alarme.');
    const acoes = page.getByRole('button').filter({ hasNotText: 'Iniciar cronômetro' });
    await acoes.last().click();
    await expect(page.getByText(/(ação guardada|ações guardadas) no aparelho/)).toBeVisible({
      timeout: 15_000,
    });

    await request.post(`${apiUrl()}/work-orders/${alvo.id}/transitions`, {
      headers: {
        authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
        'x-aurora-organization': E2E.orgA,
      },
      data: { to: 'cancelled', cancellation_reason: 'Substituído por outro equipamento.' },
    });

    toleradosNesteTeste.push(/status of 409/i);
    await context.setOffline(false);

    await page.goto('/atencao');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Precisa da sua atenção');
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('button', { name: 'Tentar de novo agora' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Já resolvi de outro jeito' }).first()).toBeVisible();

    /*
     * O DESCARTE PEDE CONFIRMAÇÃO, e a confirmação diz o que se perde.
     *
     * É o único caminho pelo qual trabalho não enviado deixa de existir neste
     * aplicativo. Um toque só, sem aviso, transformaria a tela que existe para
     * preservar trabalho na tela mais fácil de perder trabalho.
     */
    await page.getByRole('button', { name: 'Descartar este trabalho' }).first().click();
    await expect(page.getByText(/Não dá para recuperar depois/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apagar mesmo assim' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByText(/Não dá para recuperar depois/)).toBeHidden();
  });
});

test.describe('CAMPO · a tela cabe no polegar', () => {
  test('a barra fica embaixo e a página não rola de lado', async ({ comoTecnico: page }) => {
    for (const caminho of ['/', '/atencao']) {
      await page.goto(caminho);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

      const r = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(r.scroll - r.client, `${caminho} rola de lado`).toBeLessThanOrEqual(1);
    }

    const nav = page.getByRole('navigation', { name: 'Navegação do campo' });
    const caixa = await nav.boundingBox();
    const altura = page.viewportSize()!.height;
    expect(caixa!.y + caixa!.height).toBeGreaterThan(altura * 0.7);

    // Cada destino é confortável para o polegar, de luva.
    const destinos = nav.getByRole('link');
    for (let i = 0; i < (await destinos.count()); i++) {
      const c = await destinos.nth(i).boundingBox();
      expect(c!.height, `destino ${i}`).toBeGreaterThanOrEqual(44);
    }
  });
});

/**
 * Quantos apontamentos de hora esta ordem tem no SERVIDOR.
 *
 * É a pergunta que decide os dois testes centrais — "chegou?" e "chegou uma vez
 * só?" —, e ela é feita ao banco através da API, e nunca à tela. Uma tela
 * mostra o que o cliente guardou; só o servidor sabe o que aconteceu.
 */
async function contarHoras(request: APIRequestContext, workOrderId: string): Promise<number> {
  const r = await request.get(`${apiUrl()}/work-orders/${workOrderId}/time-entries`, {
    headers: cabDoTecnico,
  });
  if (!r.ok()) return 0;
  const corpo = await r.json();
  return Array.isArray(corpo.items) ? corpo.items.length : 0;
}

/**
 * Fecha os cronômetros abertos desta ordem.
 *
 * O banco admite um aberto por pessoa; um caso que deixa o seu correndo faz o
 * próximo falhar por uma razão alheia — e o rastro aponta para o lugar errado.
 */
async function pararCronometros(request: APIRequestContext, workOrderId: string): Promise<void> {
  const r = await request.get(`${apiUrl()}/work-orders/${workOrderId}/time-entries`, {
    headers: cabDoTecnico,
  });
  if (!r.ok()) return;
  const { items } = (await r.json()) as { items: { id: string; ended_at: string | null }[] };
  for (const e of items.filter((x) => !x.ended_at)) {
    await request.post(`${apiUrl()}/time-entries/${e.id}/stop`, {
      headers: cabDoTecnico,
      data: {},
    });
  }
}

test.describe('CAMPO · as cinco telas, no polegar', () => {
  test('a barra leva a Hoje, Ler QR, Enviar e Aparelho, e todas abrem sem rolar de lado', async ({
    comoTecnico: page,
  }) => {
    /*
     * A SPEC pede HOJE, OS, QR, SINCRONIZAÇÃO e PERFIL. A da OS é alcançada de
     * dentro do HOJE — ninguém procura uma ordem numa barra de navegação —, e a
     * de atenção mora dentro da sincronização, que é onde a pergunta "o que
     * ainda não chegou?" já está sendo feita.
     */
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navegação do campo' });
    await expect(nav.getByRole('link')).toHaveCount(4);

    for (const [rotulo, titulo] of [
      ['Hoje', 'Hoje'],
      ['Ler QR', 'Ler etiqueta'],
      ['Enviar', 'Sincronização'],
      ['Aparelho', 'Este aparelho'],
    ] as const) {
      await nav.getByRole('link', { name: rotulo }).click();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(titulo, {
        timeout: 20_000,
      });

      const r = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(r.scroll - r.client, `${titulo} rola de lado`).toBeLessThanOrEqual(1);
    }
  });

  test('o leitor de código resolve a etiqueta CONTRA A BASE DO APARELHO', async ({
    comoTecnico: page,
    context,
  }) => {
    /*
     * É o ponto do épico aplicado ao QR: resolver o código exige a base local,
     * e não o servidor. Um leitor que precisa de rede para dizer que
     * equipamento é aquele não serve para nada na casa de máquinas — que é
     * exatamente onde as etiquetas estão.
     *
     * Por isso o teste faz a busca EM MODO AVIÃO.
     */
    await page.goto('/');
    await sincronizado(page);

    await context.setOffline(true);
    await page.getByRole('link', { name: 'Ler QR' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ler etiqueta');

    await page.getByLabel('Ou digite o número').fill('PAT-ALFA-001');
    await page.getByRole('button', { name: 'Buscar' }).click();

    await expect(page.getByRole('heading', { level: 2 })).toContainText('Ventilador Alfa-1');
    /*
     * A seção das ordens daquele equipamento existe — com ordens ou com o vazio
     * explicado.
     *
     * A primeira versão exigia a OS do ventilador aparecendo aqui, e ela falhava
     * na execução completa: um caso anterior CANCELA essa ordem, e ordem
     * cancelada sai do pacote do dia de propósito. O teste dependia da ordem em
     * que os casos rodam, que é a forma mais cara de instabilidade.
     *
     * O que este caso prova é que o CÓDIGO RESOLVE O EQUIPAMENTO sem rede. As
     * ordens daquele equipamento são consequência, e são cobertas em outro
     * lugar.
     */
    await expect(page.getByRole('heading', { name: 'Ordens deste equipamento' })).toBeVisible();

    await context.setOffline(false);
  });

  test('um código que não está no aparelho é dito como tal — e não como inexistente', async ({
    comoTecnico: page,
  }) => {
    /*
     * A diferença é tudo em campo: o equipamento pode existir e estar fora do
     * escopo baixado hoje. "Não existe" faria o técnico concluir que a etiqueta
     * está errada e procurar um problema que não há.
     */
    await page.goto('/qr');
    await page.getByLabel('Ou digite o número').fill('PAT-QUE-NAO-EXISTE');
    await page.getByRole('button', { name: 'Buscar' }).click();

    await expect(page.getByText('Não encontrei no aparelho')).toBeVisible();
    await expect(page.getByText(/fora do escopo de hoje/)).toBeVisible();
  });
});

test.describe('CAMPO · o diagnóstico do aparelho', () => {
  test('a suíte de conformidade do armazenamento passa NO NAVEGADOR DE VERDADE', async ({
    comoTecnico: page,
  }) => {
    /*
     * ESTE TESTE FECHA O BURACO QUE NENHUM TESTE DE NODE FECHA.
     *
     * A suíte de conformidade da porta de persistência roda no Vitest contra a
     * memória e contra um SQLite de verdade. O IndexedDB não existe em Node —
     * e um simulador provaria o simulador.
     *
     * Aqui ela roda contra o IndexedDB do navegador, pela mesma tela que o
     * técnico aciona quando o suporte pede. Se uma regra reprovar num aparelho,
     * a resposta deixa de ser "deve ser o aparelho" e passa a ser uma linha com
     * nome.
     */
    await page.goto('/perfil');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Este aparelho');

    // A tela diz QUAL implementação está em uso — é a primeira pergunta do
    // suporte, e a que distingue navegador de aplicativo instalado.
    await expect(page.getByText('indexeddb')).toBeVisible();

    await page.getByRole('button', { name: 'Conferir o armazenamento' }).click();

    const resultado = page.getByRole('list', { name: 'Resultado do diagnóstico' });
    await expect(resultado).toBeVisible({ timeout: 30_000 });

    const itens = resultado.getByRole('listitem');
    await expect(itens).toHaveCount(8);
    // TODAS passam. Uma reprovada aqui é um defeito de plataforma, e o teste
    // precisa falhar por isso.
    await expect(resultado.getByText('reprovou')).toHaveCount(0);
  });

  test('sair avisa quando ainda há trabalho guardado', async ({ comoTecnico: page, context }) => {
    /*
     * Sair apaga a credencial, e sem credencial a fila não consegue enviar
     * nada — o trabalho continua guardado e vira inalcançável. Um botão de sair
     * sem este aviso, tocado por engano no fim do turno, transforma oito horas
     * de trabalho num problema de suporte.
     */
    await page.goto('/');
    await sincronizado(page);

    /*
     * A PRIMEIRA ORDEM DA LISTA, e não uma escolhida pelo título.
     *
     * Casos anteriores cancelam ordens, e ordem cancelada sai do pacote do dia.
     * Um teste que procura um título específico passa a depender da ordem em
     * que a suíte roda — e falha por um motivo que não tem relação com o que
     * ele afirma.
     */
    const primeira = page.getByRole('main').getByRole('link').first();
    await expect(primeira).toBeVisible({ timeout: 20_000 });
    await primeira.click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Iniciar cronômetro' }).click();
    await expect(page.getByText(/(ação guardada|ações guardadas) no aparelho/)).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('link', { name: 'Aparelho' }).click();
    await expect(page.getByText(/Ainda há trabalho seu esperando/)).toBeVisible();

    await context.setOffline(false);
  });
});
