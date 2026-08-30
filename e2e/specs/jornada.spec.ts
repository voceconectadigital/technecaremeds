/**
 * Aurora — A JORNADA INTEIRA, numa sessão só.
 *
 * SOLICITAÇÃO → TRIAGEM → ORDEM → ATRIBUIÇÃO → AGENDA → EXECUÇÃO →
 * FINALIZAÇÃO → FECHAMENTO.
 *
 * POR QUE ISTO EXISTE, TENDO `fluxo.spec.ts`.
 *
 * Aquele arquivo prova cada elo: abrir solicitação funciona, triar funciona,
 * programar grava. Cada caso monta o próprio arranjo pela API e testa um passo.
 * É o desenho certo para achar defeito — quando um caso falha, ele aponta para
 * um lugar.
 *
 * O que ele NÃO prova é a CORRENTE. Um produto pode ter oito telas que
 * funcionam e um caminho que não se percorre: o botão que existe mas não
 * aparece depois daquela transição, o campo que a tela seguinte precisa e a
 * anterior não gravou, o estado que só é alcançável se alguém já tiver passado
 * por outro. Nada disso aparece quando cada passo começa de um arranjo limpo
 * feito por dentro.
 *
 * Este caso percorre a corrente inteira, sem atalho pela API depois do começo,
 * do jeito que a pessoa que vai homologar o produto vai percorrer. É o roteiro
 * da homologação escrito como teste — e é por isso que ele é UM caso, e não
 * oito: dividi-lo devolveria o problema que ele existe para resolver.
 *
 * A PROVA DE CADA PASSO É DO SERVIDOR, e não da tela. A tela é por onde se
 * clica; o que se afirma é o que ficou gravado.
 */
import type { Page } from '@playwright/test';
import { test, expect, E2E, apiUrl } from '../fixtures/aurora';

const cab = {
  authorization: `Bearer local:${E2E.emailCoordA}:${E2E.emailCoordA}`,
  'x-aurora-organization': E2E.orgA,
};

/**
 * Um degrau do grafo, pela tela: clica, responde ao diálogo se houver, e espera
 * o AVISO de que a mudança foi registrada.
 *
 * Esperar o aviso — e não só o diálogo fechar — é o que impede o passo seguinte
 * de começar antes de este ter chegado ao servidor. Sem isso o caso vira uma
 * corrida entre o navegador e a asserção, e o que ganha muda de máquina para
 * máquina.
 */
async function avancar(page: Page, rotulo: string): Promise<void> {
  await page.getByRole('button', { name: rotulo, exact: true }).first().click();

  const dialogo = page.getByRole('dialog');
  if (await dialogo.isVisible().catch(() => false)) {
    await dialogo.getByRole('button', { name: rotulo, exact: true }).click();
    await expect(dialogo).toBeHidden({ timeout: 20_000 });
  }

  await expect(page.getByText(`agora está em ${rotulo}`)).toBeVisible({ timeout: 20_000 });
}

test.describe('JORNADA · do telefone tocando ao fechamento', () => {
  /*
   * O caso é longo por natureza — são oito passos com navegação entre eles — e
   * o tempo padrão de 45 segundos não é para isso. Aumentar aqui é honesto;
   * dividir o caso para caber no padrão seria desfazer o que ele prova.
   */
  test.slow();

  test('os oito passos, sem atalho: o que uma pessoa faz num dia', async ({ comoCoordenadorA: page }) => {
    const TITULO = `Jornada · desfibrilador não carrega ${Date.now()}`;

    /* ========================================================== 1 · o pedido */

    await page.goto('/solicitacoes/nova');
    await page.getByLabel(/O que está acontecendo/).fill(TITULO);
    await page.getByRole('button', { name: 'Abrir solicitação' }).click();

    await expect(page).toHaveURL(/\/solicitacoes\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const solicitacaoId = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByRole('heading', { level: 1 })).toContainText('desfibrilador não carrega');

    /* ========================================================= 2 · a triagem */

    /*
     * "Assumir triagem" é o que transforma um pedido numa responsabilidade. A
     * fila de triagem sem dono é a fila de ninguém — e o produto obriga a
     * passar por aqui antes de aceitar, o que está certo: não se aceita o que
     * ainda não se olhou.
     */
    await page.getByRole('button', { name: 'Assumir triagem' }).click();
    await expect(page.getByText('Em triagem', { exact: true })).toBeVisible({ timeout: 20_000 });

    /* ========================================================== 3 · a ordem */

    await page.getByRole('button', { name: 'Aceitar e gerar OS' }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await dialogo.getByLabel(/Natureza do trabalho/).selectOption({ label: 'Corretiva' });
    await dialogo.getByRole('button', { name: 'Gerar ordem de serviço' }).click();

    await expect(page).toHaveURL(/\/ordens$/, { timeout: 20_000 });

    // O identificador da OS vem do SERVIDOR, e não de um palpite sobre a tela:
    // é a solicitação que sabe qual ordem nasceu dela.
    const doPedido = await page.request.get(`${apiUrl()}/service-requests/${solicitacaoId}`, {
      headers: cab,
    });
    const pedido = await doPedido.json();
    expect(pedido.status, 'a solicitação precisa ter sido aceita').toBe('accepted');

    const ordens = await page.request.get(`${apiUrl()}/work-orders?limit=100`, { headers: cab });
    const { items } = await ordens.json();
    const minha = items.find((o: { title: string }) => o.title === TITULO);
    expect(minha, 'a ordem gerada precisa existir').toBeTruthy();
    const osId = minha.id;

    /* ============================== 4 e 5 · a atribuição e a programação */

    /*
     * NESTE PRODUTO, ATRIBUIR E AGENDAR SÃO O MESMO GESTO.
     *
     * Não é omissão: é a decisão que a coordenação toma de uma vez — quem vai,
     * e quando. Separá-los em duas telas produziria o estado "atribuída a
     * alguém, para nunca", que é o que enche uma fila de trabalho sem data.
     */
    await page.goto('/agenda');
    await page
      .getByRole('button', { name: new RegExp(TITULO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
      .first()
      .click();

    const programar = page.getByRole('dialog');
    await expect(programar).toBeVisible();
    await programar.getByLabel(/início/i).fill('2026-11-13T08:00');

    // O responsável é escolhido AQUI, e é o que faz a OS aparecer no aparelho
    // do técnico no dia seguinte.
    const responsavel = programar.getByLabel(/respons/i);
    if ((await responsavel.count()) > 0) {
      await responsavel.selectOption({ label: 'Rafael Técnico — jornada não cadastrada' });
    }
    await programar.getByRole('button', { name: /programar/i }).click();
    await expect(programar).toBeHidden({ timeout: 20_000 });

    const agendada = await (
      await page.request.get(`${apiUrl()}/work-orders/${osId}`, { headers: cab })
    ).json();
    expect(agendada.scheduled_start, 'a janela precisa ter sido gravada').not.toBeNull();
    expect(new Date(agendada.scheduled_start).toISOString()).toContain('2026-11-13');
    expect(agendada.assignee_membership_id, 'a ordem precisa ter dono').toBeTruthy();

    /* ======================================================= 6 · a execução */

    await page.goto(`/ordens/${osId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('desfibrilador não carrega');

    /*
     * AS AÇÕES POSSÍVEIS VÊM DO SERVIDOR, já filtradas pelo grafo e pelas
     * permissões. A tela não deduz nada — e é por isso que este teste clica no
     * que está lá em vez de mandar a transição que ele gostaria de mandar.
     */
    await page.getByRole('button', { name: 'Em execução' }).click();
    await expect(page.getByText('Em execução', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    /* ==================================================== 7 · a finalização */

    /*
     * CONCLUIR EXIGE DIZER O QUE FOI FEITO.
     *
     * O diálogo aparece porque o SERVIDOR declarou que esta transição exige
     * campo — e a tela pede antes de mandar, em vez de mandar, tomar 422 e
     * traduzir o erro de volta em formulário.
     */
    await page.getByRole('button', { name: 'Concluída' }).click();
    const conclusao = page.getByRole('dialog');
    await expect(conclusao).toBeVisible();
    await conclusao
      .getByLabel(/resolution|resolução|o que foi feito/i)
      .fill('Trocado o módulo de carga e refeito o teste de descarga.');
    await conclusao.getByRole('button', { name: 'Concluída' }).click();
    await expect(conclusao).toBeHidden({ timeout: 20_000 });

    const concluida = await (
      await page.request.get(`${apiUrl()}/work-orders/${osId}`, { headers: cab })
    ).json();
    expect(concluida.completed_at, 'concluir precisa carimbar a hora').toBeTruthy();
    expect(concluida.resolution).toContain('módulo de carga');

    /* ====================================================== 8 · o fechamento */

    /*
     * VALIDAR E FECHAR SÃO DOIS ATOS, e a diferença é de quem responde.
     *
     * Validar é a coordenação conferindo o trabalho; fechar é o registro
     * virando definitivo — e é do fechamento que o faturamento e o indicador
     * partem. Um produto que junta os dois num botão só perde a única janela em
     * que dá para devolver o trabalho sem reabrir nada.
     */
    await avancar(page, 'Validada');
    await avancar(page, 'Fechada');

    /*
     * A LEITURA DO SERVIDOR ESPERA O EFEITO, e não corre na frente dele.
     *
     * A primeira versão lia logo depois do clique e encontrou a OS ainda em
     * "concluída" — enquanto o aviso na tela já dizia "Fechada". Não era
     * defeito do produto: era o teste perguntando antes de a resposta ter
     * voltado. Ler uma vez, cedo, é o jeito mais silencioso de um teste mentir.
     */
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${apiUrl()}/work-orders/${osId}`, { headers: cab })).json())
            .status_category,
        { timeout: 20_000, message: 'a jornada termina em fechada' }
      )
      .toBe('closed');

    /* ------------------------------------------------------- e o histórico */

    /*
     * O HISTÓRICO É A PROVA DE QUE A CORRENTE FOI PERCORRIDA, e não montada.
     *
     * Uma OS que chegasse a "fechada" por escrita direta teria histórico vazio
     * — e é justamente no histórico que a auditoria olha para saber se o
     * trabalho existiu. Exigir os degraus aqui é exigir que o caminho tenha
     * sido caminhado.
     */
    const detalhe = await (
      await page.request.get(`${apiUrl()}/work-orders/${osId}`, { headers: cab })
    ).json();
    const degraus = (detalhe.history as { to_label: string }[]).map((h) => h.to_label);
    for (const degrau of ['Em execução', 'Concluída', 'Validada', 'Fechada']) {
      expect(degraus, `o histórico precisa registrar a passagem por "${degrau}"`).toContain(degrau);
    }

    /*
     * E A ORDEM DOS DEGRAUS, que é o que "corrente" quer dizer.
     *
     * Conter os quatro não basta: um produto que registrasse "fechada" antes de
     * "concluída" passaria na conferência acima e estaria errado de um jeito
     * que só aparece numa auditoria, meses depois.
     */
    const posicao = (r: string) => degraus.indexOf(r);
    expect(posicao('Em execução')).toBeLessThan(posicao('Concluída'));
    expect(posicao('Concluída')).toBeLessThan(posicao('Validada'));
    expect(posicao('Validada')).toBeLessThan(posicao('Fechada'));
  });
});
