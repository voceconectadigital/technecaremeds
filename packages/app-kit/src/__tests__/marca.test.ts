/**
 * Aurora — a marca mora num lugar só, e esta prova é o que mantém isso verdade.
 *
 * O CLIENTE AINDA NÃO APROVOU UM NOME COMERCIAL.
 *
 * "Aurora" é nome de trabalho, e a homologação vai mostrá-lo na tela. Quando o
 * nome definitivo vier, a troca precisa ser uma edição em `marca.config.json`
 * seguida de `npm run marca` — e não uma caçada a strings em cinco aplicações,
 * dois projetos nativos e três manifestos.
 *
 * Uma centralização sem guarda dura até o próximo commit apressado: alguém
 * escreve o nome direto numa tela, ninguém vê na revisão, e a troca futura
 * deixa essa tela para trás. A que sobrar vai aparecer justamente onde ninguém
 * olha — a aba do navegador de um cliente, o rótulo abaixo do ícone.
 *
 * Por isso a regra é verificada, e não combinada.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARCA } from '../marca.gerada';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function arquivosDe(dir: string, extensoes: string[]): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === 'node_modules' || nome === 'dist' || nome === '.tsc-out') continue;
      saida.push(...arquivosDe(caminho, extensoes));
    } else if (extensoes.some((e) => nome.endsWith(e))) {
      saida.push(caminho);
    }
  }
  return saida;
}

/**
 * O que é NAMESPACE TÉCNICO e não marca.
 *
 * `x-aurora-*` nos cabeçalhos, `aurora:` nas chaves de armazenamento,
 * `aurora_app` nos papéis do banco, `@aurora/*` nos pacotes, `aurora.` nos
 * esquemas SQL e `aurora-*` nas classes do sistema de design. Trocá-los junto
 * com o nome comercial quebraria sessões guardadas, migrations já aplicadas, a
 * fila offline de quem tem trabalho no aparelho e a folha de estilo — e nada
 * disso aparece para o cliente. Uma classe de CSS nunca é lida por ninguém.
 *
 * A separação é o ponto: "renomear o produto" e "renomear o sistema" são
 * tarefas diferentes, e só a primeira é reversível.
 */
const NAMESPACES_TECNICOS =
  /@aurora\/|x-aurora-|aurora:|aurora_|AURORA_|aurora\.|aurora-[a-z]|'aurora\/|`aurora\/|\[aurora\]/;

describe('a marca não é escrita à mão nas telas', () => {
  it('nenhum código de interface contém o nome do produto literalmente', () => {
    const fontes = [
      join(RAIZ, 'apps', 'web', 'src'),
      join(RAIZ, 'apps', 'portal', 'src'),
      join(RAIZ, 'apps', 'field', 'src'),
    ].flatMap((d) => arquivosDe(d, ['.ts', '.tsx']));

    const infratores: string[] = [];

    for (const caminho of fontes) {
      // O próprio módulo gerado carrega o nome — é a fonte, e não uma cópia.
      if (caminho.endsWith('marca.gerada.ts')) continue;

      const linhas = readFileSync(caminho, 'utf8').split('\n');
      let dentroDeComentario = false;

      linhas.forEach((linha, i) => {
        /*
         * COMENTÁRIOS SÃO ISENTOS, e é uma isenção deliberada.
         *
         * Este repositório explica as decisões por extenso, e as explicações
         * citam o produto pelo nome de trabalho. Um comentário não vai para a
         * tela de ninguém — proibi-lo trocaria uma regra útil por ruído.
         */
        const limpa = linha.trim();
        if (limpa.startsWith('/*')) dentroDeComentario = true;
        const eraComentario = dentroDeComentario;
        if (limpa.includes('*/')) dentroDeComentario = false;
        if (eraComentario || limpa.startsWith('//') || limpa.startsWith('*')) return;

        if (!new RegExp(MARCA.produto, 'i').test(linha)) return;
        if (NAMESPACES_TECNICOS.test(linha)) return;

        infratores.push(`${caminho.replace(RAIZ, '.')}:${i + 1}  ${limpa.slice(0, 90)}`);
      });
    }

    if (infratores.length > 0) {
      throw new Error(
        `o nome do produto está escrito à mão em ${infratores.length} lugar(es).\n` +
          'Use MARCA de @aurora/app-kit — o cliente ainda não aprovou o nome comercial,\n' +
          'e cada literal é uma tela que a troca futura vai deixar para trás:\n\n' +
          infratores.map((i) => '  · ' + i).join('\n')
      );
    }
  });

  it('as superfícies fora do TypeScript estão em dia com a configuração', () => {
    /*
     * `<title>`, manifesto, `strings.xml` e `Info.plist` não conseguem importar
     * nada — eles são carimbados por `npm run marca`. Esta prova é a mesma
     * conferência que o gate faz, aqui dentro da suíte: quem editar a
     * superfície em vez da fonte descobre no teste, e não na loja.
     */
    const config = JSON.parse(readFileSync(join(RAIZ, 'marca.config.json'), 'utf8'));

    const manifesto = JSON.parse(
      readFileSync(join(RAIZ, 'apps', 'field', 'public', 'manifest.webmanifest'), 'utf8')
    );
    expect(manifesto.name).toBe(config.aplicacoes.campo.nomeNaTela);
    expect(manifesto.short_name).toBe(config.aplicacoes.campo.nomeCurto);

    const strings = readFileSync(
      join(RAIZ, 'apps', 'field', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
      'utf8'
    );
    expect(strings).toContain(`<string name="app_name">${config.aplicacoes.campo.nomeNaTela}</string>`);

    for (const [app, chave] of [
      ['web', 'web'],
      ['portal', 'portal'],
      ['field', 'campo'],
    ] as const) {
      const html = readFileSync(join(RAIZ, 'apps', app, 'index.html'), 'utf8');
      expect(html, `${app}/index.html`).toContain(`<title>${config.aplicacoes[chave].titulo}</title>`);
    }
  });

  it('o identificador do aplicativo continua marcado como NÃO definitivo', () => {
    /*
     * Congelar `appId` antes de o cliente decidir o nome é irreversível: uma vez
     * publicado, trocá-lo cria um aplicativo novo, sem as instalações e sem as
     * avaliações.
     *
     * A prova existe para que remover essa marcação seja uma decisão consciente,
     * e não um efeito colateral de alguém "limpando" a configuração.
     */
    const config = JSON.parse(readFileSync(join(RAIZ, 'marca.config.json'), 'utf8'));
    expect(config.$naoDefinitivo).toBeDefined();
    expect(config.$naoDefinitivo.situacao).toMatch(/A VALIDAR/);
    expect(config.$naoDefinitivo.appId).toBeTruthy();
  });
});
