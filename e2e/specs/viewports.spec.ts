/**
 * Aurora — a tela nas cinco larguras (SPEC v0.2 §34).
 *
 * O QUE ESTE ARQUIVO MEDE, E POR QUE ISSO E NÃO CAPTURA DE TELA.
 *
 * Comparar imagens pixel a pixel produz um teste que falha quando alguém muda
 * uma sombra, e que passa quando o texto some atrás de um botão. O que quebra
 * de verdade num layout responsivo é sempre uma das quatro coisas abaixo, e
 * todas são decidíveis por máquina:
 *
 *   1. ROLAGEM HORIZONTAL NA PÁGINA. É o defeito que mais some em revisão de
 *      mesa e mais aparece no celular: uma tabela larga, um título que não
 *      trunca, um `min-width` esquecido. A página inteira passa a deslizar de
 *      lado, e metade dos controles fica fora de alcance.
 *
 *   2. CONTEÚDO CORTADO. Um elemento cuja largura ultrapassa a da janela é
 *      texto que ninguém lê e botão que ninguém alcança.
 *
 *   3. ALVO DE TOQUE PEQUENO DEMAIS. Abaixo de 24×24 CSS px, o dedo erra —
 *      é o mínimo da WCAG 2.2 (2.5.8), e no celular é a diferença entre
 *      apontar e adivinhar.
 *
 *   4. O CONTROLE PRINCIPAL SUMIR. Numa largura de celular, o menu vira gaveta
 *      e o botão que a abre é o único caminho: se ele não estiver lá, a
 *      navegação inteira desapareceu.
 *
 * As cinco larguras são as pedidas: 1440×900 (monitor de trabalho), 1280×800
 * (notebook), 1024×768 (o tablet deitado e o monitor antigo que ainda existe
 * em recepção de hospital), 768×1024 (tablet em pé) e 390×844 (celular).
 */
import { test, expect } from '../fixtures/aurora';

const LARGURAS = [
  { nome: 'monitor', width: 1440, height: 900 },
  { nome: 'notebook', width: 1280, height: 800 },
  { nome: 'monitor antigo', width: 1024, height: 768 },
  { nome: 'tablet em pé', width: 768, height: 1024 },
  { nome: 'celular', width: 390, height: 844 },
] as const;

/** As telas com mais risco de estourar: listas largas, quadro, painel. */
const TELAS = ['/', '/ordens?vista=lista', '/ativos', '/estoque', '/indicadores', '/agenda'];

for (const v of LARGURAS) {
  for (const caminho of TELAS) {
    test(`${caminho} cabe em ${v.width}×${v.height} (${v.nome})`, async ({ comoCoordenadorA: page }) => {
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.goto(caminho);
      const titulo = page.getByRole('heading', { level: 1 });
      await expect(titulo).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });

      /*
       * O TÍTULO PRECISA TER LARGURA DE VERDADE, e não só estar "visível".
       *
       * "Visível" é um limiar baixo: um contêiner esmagado a poucos pixels
       * ainda passa em alguns arranjos, e o texto some sem a asserção reclamar.
       * Foi assim que este defeito atravessou esta máquina e só apareceu na
       * integração contínua, em Linux, onde as fontes são outras e as ações do
       * cabeçalho ficam alguns pixels mais largas.
       *
       * 80px é o piso: abaixo disso não cabe nem uma palavra com reticências, e
       * o que a pessoa vê é um cabeçalho sem nome.
       */
      const caixa = await titulo.boundingBox();
      expect(caixa, 'o título não tem caixa').not.toBeNull();
      expect(caixa!.width, 'o título foi esmagado pelas ações do cabeçalho').toBeGreaterThan(80);

      /*
       * 1. A PÁGINA NÃO ROLA DE LADO.
       *
       * A tolerância de 1px absorve arredondamento de sub-pixel do navegador;
       * qualquer coisa acima disso é layout estourado de verdade.
       */
      const rolagem = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(
        rolagem.scroll - rolagem.client,
        `${caminho} em ${v.width}px rola ${rolagem.scroll - rolagem.client}px de lado`
      ).toBeLessThanOrEqual(1);

      /*
       * 2. NADA VISÍVEL ULTRAPASSA A JANELA.
       *
       * A verificação ignora quem tem rolagem PRÓPRIA — o quadro Kanban rola
       * de lado de propósito, e isso é diferente da página inteira deslizar.
       */
      const estourando = await page.evaluate((limite) => {
        const fora: string[] = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const e = el as HTMLElement;
          if (e.offsetParent === null && e.tagName !== 'BODY') continue;
          const estilo = getComputedStyle(e);
          if (estilo.overflowX === 'auto' || estilo.overflowX === 'scroll') continue;
          // Um elemento DENTRO de um rolável horizontal pode passar do limite
          // legitimamente: quem rola é o pai.
          let p = e.parentElement;
          let dentroDeRolavel = false;
          while (p) {
            const ep = getComputedStyle(p);
            if (ep.overflowX === 'auto' || ep.overflowX === 'scroll') {
              dentroDeRolavel = true;
              break;
            }
            p = p.parentElement;
          }
          if (dentroDeRolavel) continue;

          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > limite + 1) {
            fora.push(
              `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} termina em ${Math.round(r.right)}px`
            );
          }
        }
        return fora.slice(0, 5);
      }, v.width);

      expect(estourando, `${caminho} em ${v.width}px tem conteúdo fora da janela`).toEqual([]);

      /*
       * 3. ALVO DE TOQUE.
       *
       * Só no celular: no desktop o ponteiro é preciso, e exigir 24px de tudo
       * transformaria a interface numa sequência de botões enormes. A regra
       * vale onde o dedo é o instrumento.
       */
      if (v.width < 768) {
        const pequenos = await page.evaluate(() => {
          const ruins: string[] = [];
          const alvos = document.querySelectorAll('button, a[href], [role="tab"], input, select');
          for (const el of Array.from(alvos)) {
            const e = el as HTMLElement;
            const r = e.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.width < 24 || r.height < 24) {
              ruins.push(
                `${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute('aria-label') || '(sem nome)').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`
              );
            }
          }
          return ruins.slice(0, 5);
        });
        expect(pequenos, `${caminho} no celular tem alvo de toque menor que 24×24`).toEqual([]);
      }
    });
  }
}

test.describe('a navegação sobrevive ao celular', () => {
  test('o menu vira gaveta, e o botão que a abre existe', async ({ comoCoordenadorA: page }) => {
    /*
     * A barra lateral some abaixo de certa largura — e some de propósito, para
     * o conteúdo caber. Mas se o botão da gaveta não estiver lá, a navegação
     * inteira desapareceu: a pessoa fica presa na tela em que entrou.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    const abrir = page.getByRole('button', { name: 'Abrir menu' });
    await expect(abrir).toBeVisible();
    await abrir.click();

    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ordens de serviço' })).toBeVisible();
  });
});
