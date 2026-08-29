/**
 * Aurora — notificações, no navegador (EPIC-023).
 *
 * A caixa de uma organização recém-semeada está VAZIA, e é assim de propósito:
 * notificação nasce de evento, e semeá-la por escrita direta produziria um
 * estado que a aplicação não sabe criar — o teste passaria a provar um mundo
 * que não existe. A caixa COM conteúdo, incluindo o isolamento entre pessoas,
 * é coberta pelos testes de API.
 *
 * O que este arquivo prova é a TELA: o vazio explicado, as preferências por
 * (tipo, canal), e a promessa honesta sobre o horário de silêncio.
 */
import { test, expect } from '../fixtures/aurora';

test.describe('EPIC-023 · notificações', () => {
  test('a caixa vazia explica o que vai aparecer ali', async ({ comoCoordenadorA: page }) => {
    await page.goto('/notificacoes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Notificações');

    // Vazio EXPLICADO, e não uma área em branco: quem abre precisa saber que a
    // tela funciona e que simplesmente não há nada.
    await expect(page.getByText('Nada por aqui')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/aparece aqui — e no sino/)).toBeVisible();

    // Sem nada para marcar, o botão não aparece: um botão que não faz nada
    // ensina que os botões desta tela não fazem nada.
    await expect(page.getByRole('button', { name: 'Marcar tudo como lido' })).toBeHidden();
  });

  test('as preferências são por tipo E por canal, na mesma tela da caixa', async ({
    comoCoordenadorA: page,
  }) => {
    /*
     * O momento em que alguém decide mexer nas preferências é o momento em que
     * está incomodado com o que chegou. Mandar essa pessoa procurar a
     * configuração noutra tela é o que faz a alternativa real ser desligar
     * tudo — e uma equipe com as notificações desligadas descobre o SLA
     * estourado pelo cliente.
     */
    await page.goto('/notificacoes');
    await page.getByRole('tab', { name: 'Preferências' }).click();

    await expect(page.getByText('O que avisar, e por onde')).toBeVisible({ timeout: 15_000 });

    // Cada tipo oferece SEUS canais, e a frequência é escolha por canal.
    //
    // A espera é pelo PRIMEIRO seletor, e não pelo cabeçalho do cartão: o
    // cabeçalho renderiza junto com o esqueleto de carregamento, e contar ali
    // conta zero — foi o que fez este teste passar e falhar em execuções
    // seguidas.
    const seletores = page.getByRole('combobox', { name: /Frequência de/ });
    await expect(seletores.first()).toBeVisible({ timeout: 15_000 });
    expect(await seletores.count()).toBeGreaterThan(0);

    // "não avisar" é uma opção do mesmo seletor da frequência: separar o
    // ligar/desligar da frequência criaria dois controles para uma decisão só.
    await expect(seletores.first().getByRole('option', { name: 'não avisar' })).toHaveCount(1);
    await expect(seletores.first().getByRole('option', { name: 'resumo semanal' })).toHaveCount(1);
  });

  test('o horário de silêncio promete o que cumpre — e diz o que atravessa', async ({
    comoCoordenadorA: page,
  }) => {
    await page.goto('/notificacoes?aba=preferencias');

    /*
     * PELO PAPEL, e não pelo texto solto. A diferença aqui não é estilo.
     *
     * `getByText('Horário de silêncio')` casa DUAS coisas nesta tela: o título
     * do cartão e o texto só-para-leitor-de-tela de cada tipo que atravessa o
     * silêncio ("...atravessa o horário de silêncio..."). O segundo só existe
     * depois que a lista de tipos chega do servidor.
     *
     * O resultado era uma prova que passava ou falhava conforme a consulta
     * respondesse antes ou depois da asserção — e falhava com "strict mode
     * violation", que soa como defeito do teste e não como o que era: a
     * consulta tinha acabado de chegar. Passou dezenas de vezes até a máquina
     * ficar rápida o bastante.
     *
     * O papel `heading` casa um elemento só, hoje e depois de a lista chegar.
     */
    await expect(page.getByRole('heading', { name: 'Horário de silêncio' })).toBeVisible({
      timeout: 15_000,
    });

    /*
     * PROMETER SILÊNCIO ABSOLUTO SERIA PIOR do que não prometer.
     *
     * Silenciar de verdade um SLA estourando às 3h num hospital é inaceitável;
     * e prometer silêncio e depois tocar destrói a confiança na configuração.
     * A saída é dizer, no próprio tipo, qual atravessa.
     */
    await expect(page.getByText(/exceto os avisos marcados/)).toBeVisible();
    // Espera a lista de tipos chegar: a marca vive nela, e não no cartão de
    // silêncio.
    await expect(page.getByText('atravessa o silêncio').first()).toBeVisible({ timeout: 15_000 });
  });

  test('a aba fica na URL', async ({ comoCoordenadorA: page }) => {
    await page.goto('/notificacoes');
    await page.getByRole('tab', { name: 'Preferências' }).click();
    expect(page.url()).toContain('aba=preferencias');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Preferências' })).toHaveAttribute('aria-selected', 'true');
  });
});
