#!/usr/bin/env node
/**
 * Aurora — a fumaça: o ambiente de homologação está de pé e inteiro?
 *
 * O QUE ISTO É, E O QUE NÃO É.
 *
 * Não é a suíte. A suíte roda contra um banco que ela mesma monta, e prova o
 * PRODUTO. Isto roda contra uma implantação que já existe, e prova a
 * IMPLANTAÇÃO: que a API subiu, que o banco tem as migrações, que a massa está
 * lá, que as permissões separam as pessoas, que o portal não vaza, e que os
 * bytes de um anexo chegam ao servidor — que é a peça que mais depende de
 * configuração do ambiente e a que falha primeiro num servidor efêmero.
 *
 * Um ambiente pode estar com o código certo e a configuração errada de seis
 * jeitos diferentes. Nenhum deles aparece num teste que roda na máquina de quem
 * escreveu o código.
 *
 * O ESPAÇO É PRÓPRIO, E ISSO NÃO É DETALHE.
 *
 * Tudo o que este script cria leva um carimbo — `[FUMAÇA <instante>]` — e ele
 * nunca toca em nada que não tenha criado. Um roteiro de verificação que mexe na
 * massa que o cliente está explorando estraga a avaliação enquanto tenta
 * ajudá-la: a pessoa volta à tela e o chamado que ela estava lendo mudou de
 * estado sozinho.
 *
 * E ELE NÃO APAGA NADA.
 *
 * O que ele cria fica, carimbado e reconhecível. Apagar exigiria privilégio que
 * um roteiro de verificação não deve ter — e um script de fumaça com poder de
 * apagar é um acidente esperando o dia em que alguém o apontar para o ambiente
 * errado.
 *
 * DE QUEM PRECISA SER A SESSÃO.
 *
 * `AURORA_SMOKE_TOKEN` tem de ser a de um TÉCNICO, e isso não é arbitrário: o
 * roteiro abre um chamado e anexa um arquivo, e neste produto quem origina
 * trabalho é técnico, solicitante ou gestor de cliente — a coordenação recebe
 * demanda, não a inventa. Uma sessão de coordenação falha aqui com 403, e o 403
 * está certo.
 *
 * `AURORA_SMOKE_TOKEN_PORTAL` é opcional: com ela, o roteiro confere também que
 * o portal não devolve nada da prestadora.
 *
 * Uso:
 *   AURORA_SMOKE_URL=https://... \
 *   AURORA_SMOKE_TOKEN='local:tiago.tecnico@…:tiago.tecnico@…' \
 *   AURORA_SMOKE_ORG=<uuid> \
 *   node tools/smoke/homologacao.mjs
 *
 * Sai com 0 se tudo passou, 1 se alguma coisa falhou. O relatório é a saída.
 */

const base = (process.env.AURORA_SMOKE_URL ?? '').replace(/\/+$/, '');
const token = process.env.AURORA_SMOKE_TOKEN ?? '';
const org = process.env.AURORA_SMOKE_ORG ?? '';
const tokenPortal = process.env.AURORA_SMOKE_TOKEN_PORTAL ?? '';

if (!base) {
  console.error(
    '\nAURORA_SMOKE_URL não definido.\n\n' +
      'Aponte para a raiz da API — por exemplo https://homolog.exemplo/v1 — e\n' +
      'informe também AURORA_SMOKE_TOKEN e AURORA_SMOKE_ORG.\n'
  );
  process.exit(1);
}

const CARIMBO = `[FUMAÇA ${new Date().toISOString().slice(0, 19).replace('T', ' ')}]`;

/* -------------------------------------------------------------------------- */

const resultados = [];

/**
 * Uma verificação.
 *
 * A falha NÃO interrompe as seguintes: um ambiente com três coisas erradas
 * precisa mostrar as três de uma vez. Um roteiro que para na primeira obriga a
 * três idas e voltas, e cada ida é uma implantação.
 */
async function conferir(nome, fn) {
  try {
    const detalhe = await fn();
    resultados.push({ nome, ok: true, detalhe: detalhe ?? '' });
  } catch (e) {
    resultados.push({ nome, ok: false, detalhe: e instanceof Error ? e.message : String(e) });
  }
}

function exigir(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

const cabecalhos = (extra = {}, comoPortal = false) => ({
  authorization: `Bearer ${comoPortal ? tokenPortal : token}`,
  ...(org ? { 'x-aurora-organization': org } : {}),
  ...extra,
});

async function pedir(caminho, opcoes = {}) {
  const r = await fetch(`${base}${caminho}`, {
    ...opcoes,
    headers: cabecalhos(opcoes.headers ?? {}, opcoes.comoPortal),
  });
  let corpo = null;
  try {
    corpo = await r.json();
  } catch {
    /* resposta sem corpo, ou que não é JSON. O status decide. */
  }
  return { status: r.status, corpo };
}

/* -------------------------------------------------------------------------- */
/* as verificações                                                            */
/* -------------------------------------------------------------------------- */

async function main() {
  /* ------------------------------------------------------ 1 · está de pé */

  await conferir('a API responde', async () => {
    const r = await fetch(`${base}/health/live`);
    exigir(r.status === 200, `esperava 200 em /health/live, veio ${r.status}`);
    return 'viva';
  });

  await conferir('o banco responde e as migrações estão aplicadas', async () => {
    const r = await fetch(`${base}/health/ready`);
    exigir(r.status === 200, `esperava 200 em /health/ready, veio ${r.status}`);
    return 'pronta';
  });

  if (!token) {
    relatar();
    console.log('\nSem AURORA_SMOKE_TOKEN as verificações que dependem de sessão foram puladas.\n');
    return;
  }

  /* ---------------------------------------------- 2 · a sessão e a massa */

  await conferir('a sessão é reconhecida, e sabe em que organização está', async () => {
    const { status, corpo } = await pedir('/me/organizations');
    exigir(status === 200, `/me/organizations devolveu ${status}`);
    exigir(corpo?.items?.length > 0, 'a sessão não tem vínculo em organização nenhuma');
    return `${corpo.items.length} organização(ões)`;
  });

  let osExistente = null;

  await conferir('a massa de homologação está no ar', async () => {
    const { status, corpo } = await pedir('/work-orders?limit=5');
    exigir(status === 200, `/work-orders devolveu ${status}`);
    exigir(
      Array.isArray(corpo?.items) && corpo.items.length > 0,
      'nenhuma ordem de serviço: o banco subiu sem massa'
    );
    osExistente = corpo.items[0];
    return `${corpo.items.length} ordem(ns) na primeira página`;
  });

  await conferir('os catálogos foram provisionados', async () => {
    const { status, corpo } = await pedir('/catalogs/work_order_type/items');
    exigir(status === 200, `catálogo devolveu ${status}`);
    exigir(corpo?.items?.length > 0, 'nenhuma natureza de trabalho cadastrada');
    return `${corpo.items.length} natureza(s)`;
  });

  /* ------------------------------------------- 3 · a permissão SEPARA */

  await conferir('uma sessão sem credencial é recusada', async () => {
    const r = await fetch(`${base}/work-orders`);
    exigir(
      r.status === 401 || r.status === 403,
      `esperava recusa sem credencial, veio ${r.status} — a API está aberta`
    );
    return `recusa ${r.status}`;
  });

  await conferir('uma credencial inventada é recusada', async () => {
    const r = await fetch(`${base}/work-orders`, {
      headers: { authorization: 'Bearer local:ninguem@lugar.nenhum:x' },
    });
    exigir(
      r.status === 401 || r.status === 403,
      `esperava recusa para quem não tem vínculo, veio ${r.status}`
    );
    return `recusa ${r.status}`;
  });

  /* -------------------------------------------- 4 · o portal não vaza */

  if (tokenPortal) {
    /*
     * As mesmas chaves que a prova PORTAL-011 procura na suíte. A lista é
     * repetida aqui de propósito, e não importada: este script roda contra um
     * ambiente remoto, possivelmente numa versão do código diferente da que
     * está nesta máquina. Importar da suíte faria a verificação medir o
     * repositório local em vez do ambiente.
     */
    const PROIBIDAS = [
      'cost',
      'unit_cost',
      'total_cost',
      'margin',
      'markup',
      'supplier',
      'supplier_name',
      'internal_note',
      'internal_notes',
      'assignee',
      'assignee_name',
      'assignee_membership_id',
      'team_name',
      'purchase_value',
    ];

    const chavesDe = (v, achadas = new Set()) => {
      if (Array.isArray(v)) {
        for (const x of v) chavesDe(x, achadas);
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          achadas.add(k);
          chavesDe(x, achadas);
        }
      }
      return achadas;
    };

    for (const rota of ['/portal/home', '/portal/requests', '/portal/work-orders', '/portal/assets']) {
      await conferir(`o portal não vaza em ${rota}`, async () => {
        const { status, corpo } = await pedir(rota, { comoPortal: true });
        exigir(status === 200, `${rota} devolveu ${status}`);
        const vazadas = [...chavesDe(corpo)].filter((k) => PROIBIDAS.includes(k));
        exigir(vazadas.length === 0, `devolveu ${vazadas.join(', ')}`);
        return 'limpo';
      });
    }
  }

  /* --------------------------------- 5 · o caminho crítico, no espaço próprio */

  let chamadoDaFumaca = null;

  await conferir('abrir um chamado com carimbo próprio', async () => {
    const { status, corpo } = await pedir('/service-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer_id: osExistente?.customer_id,
        summary: `${CARIMBO} verificação automática do ambiente`,
        source: 'phone',
      }),
    });
    exigir(
      status === 201,
      status === 403
        ? 'a sessão não pode abrir chamado. AURORA_SMOKE_TOKEN precisa ser de quem ' +
            'ORIGINA trabalho — técnico, solicitante ou gestor —, e não de quem tria: ' +
            'a coordenação recebe demanda, não a inventa, e a permissão reflete isso'
        : `criar chamado devolveu ${status}: ${JSON.stringify(corpo)}`
    );
    chamadoDaFumaca = corpo.id;
    return corpo.number ?? corpo.id;
  });

  await conferir('o chamado criado é encontrado de volta', async () => {
    exigir(chamadoDaFumaca, 'o chamado não foi criado; nada a procurar');
    const { status, corpo } = await pedir(`/service-requests/${chamadoDaFumaca}`);
    exigir(status === 200, `ler o chamado devolveu ${status}`);
    exigir(String(corpo.summary).includes('FUMAÇA'), 'o carimbo não sobreviveu à ida e volta');
    return corpo.status;
  });

  /*
   * O ANEXO É A VERIFICAÇÃO QUE MAIS IMPORTA NUM AMBIENTE NOVO.
   *
   * Ela atravessa quatro coisas de configuração ao mesmo tempo: o corpo cru
   * chegando ao servidor, o diretório de arquivos existindo e sendo gravável, o
   * disco persistindo, e o resumo criptográfico fechando. Num contêiner com
   * disco efêmero é a primeira coisa que quebra — e quebra em silêncio, porque
   * o registro do anexo continua entrando no banco.
   */
  await conferir('os BYTES de um anexo sobem e o servidor confirma', async () => {
    exigir(osExistente, 'sem ordem de serviço não há onde anexar');

    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 13) % 251;
    const resumo = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const registro = await pedir(`/work-orders/${osExistente.id}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        purpose: 'other',
        file_name: 'fumaca.jpg',
        content_type: 'image/jpeg',
        byte_size: bytes.length,
        sha256: resumo,
      }),
    });
    exigir(
      registro.status === 201,
      registro.status === 403
        ? 'a sessão não pode anexar. AURORA_SMOKE_TOKEN precisa ter ' +
            '"work_order.execute" — na prática, a sessão de um técnico'
        : `registrar o anexo devolveu ${registro.status}: ${JSON.stringify(registro.corpo)}`
    );

    const envio = await fetch(`${base}/field/attachments/${registro.corpo.attachment_id}/bytes`, {
      method: 'PUT',
      headers: cabecalhos({
        'content-type': 'application/octet-stream',
        'x-aurora-offset': '0',
        'x-aurora-sha256': resumo,
        'x-aurora-final': '1',
      }),
      body: bytes,
    });
    const desfecho = await envio.json().catch(() => null);
    exigir(
      envio.status === 200,
      `enviar os bytes devolveu ${envio.status}: ${JSON.stringify(desfecho)} — ` +
        'confira AURORA_ARQUIVOS_DIR e se o disco é persistente'
    );
    exigir(desfecho?.completed === true, 'o servidor recebeu os bytes e não deu o envio por completo');
    return `${bytes.length} bytes, resumo conferido`;
  });

  relatar();
}

/* -------------------------------------------------------------------------- */

function relatar() {
  const largura = Math.max(...resultados.map((r) => r.nome.length));
  console.log(`\nAurora — verificação do ambiente\n${base}\n`);
  for (const r of resultados) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.nome.padEnd(largura)}  ${r.detalhe}`);
  }

  const falhas = resultados.filter((r) => !r.ok);
  console.log(
    falhas.length === 0
      ? `\n${resultados.length} verificações, todas passaram.\n` +
          `O que este roteiro criou está carimbado com "${CARIMBO}" e NÃO foi apagado.\n`
      : `\n${falhas.length} de ${resultados.length} FALHARAM.\n`
  );
  if (falhas.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
