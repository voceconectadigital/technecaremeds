/**
 * Aurora — o que precisa estar no aparelho antes de a rede acabar
 * (SPEC v0.2 §20 · EPIC-014).
 *
 * A REGRA QUE ORGANIZA ESTE ARQUIVO: o técnico não escolhe o que baixar.
 *
 * Um botão "sincronizar esta OS" garante que a que ele esqueceu de tocar é
 * justamente a que ele vai precisar no subsolo. O escopo do dia vem inteiro, de
 * uma vez, decidido pelo servidor a partir do vínculo — e o vínculo é o mesmo
 * que já limita tudo o mais neste sistema.
 *
 * O RECORTE É O DA SPEC, TABELA POR TABELA
 *
 *   · OS atribuídas a mim, dos próximos 7 dias mais todas as abertas;
 *   · os ativos referenciados por elas;
 *   · os modelos de checklist publicados que elas podem usar;
 *   · os catálogos inteiros (são pequenos, e sem eles nada renderiza);
 *   · os locais do escopo;
 *   · o saldo do almoxarifado — indicativo, e dito como indicativo.
 *
 * O QUE NÃO ESTÁ AQUI, E POR QUÊ
 *
 * Fotos. Elas são grandes, e a política delas é oposta à de tudo isto: sobem
 * numa fila com envio retomável, e não descem num pacote. Misturá-las faria o
 * pacote do dia chegar a centenas de megabytes numa rede de hospital.
 */
import type { TenantSession } from './client';

/**
 * O corte incremental.
 *
 * `since` é o instante do último pacote que o aparelho recebeu inteiro. Sem
 * ele, o técnico baixa tudo toda manhã; com ele, baixa o que mudou.
 *
 * O RELÓGIO É O DO SERVIDOR, e nunca o do aparelho. A SPEC lista "relógio do
 * dispositivo errado" entre os casos de borda, e um celular com a data trocada
 * pediria "o que mudou desde 2019" (baixa tudo, lento mas correto) ou "desde
 * 2027" (não baixa nada — e o técnico vai a campo achando que está sincronizado).
 * Por isso o servidor devolve o SEU instante em `synced_at`, e é ele que volta
 * na próxima chamada.
 */
export interface FieldSyncParams {
  since?: Date | null;
  /** Quantos dias à frente considerar. A SPEC diz 7. */
  horizonDays?: number;
}

export interface FieldSyncBundle {
  synced_at: string;
  incremental: boolean;
  work_orders: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  checklist_templates: Record<string, unknown>[];
  catalogs: Record<string, unknown>[];
  statuses: Record<string, unknown>[];
  transitions: Record<string, unknown>[];
  wait_reasons: Record<string, unknown>[];
  stock: Record<string, unknown>[];
  counts: Record<string, number>;
}

/**
 * O pacote do dia.
 *
 * SEQUENCIAL, e não `Promise.all`. As consultas rodam na mesma sessão de banco
 * — a mesma conexão física, dentro da mesma transação, com o contexto do tenant
 * fixado por `set_config`. O driver `pg` não multiplexa: disparar tudo de uma
 * vez faz uma consulta atropelar a outra e o contexto se perder no meio. O
 * sintoma é uma recusa que parece de permissão, e foi assim que ela apareceu no
 * portal.
 */
export async function fieldSyncBundle(
  s: TenantSession,
  membershipId: string,
  params: FieldSyncParams = {}
): Promise<FieldSyncBundle> {
  const horizonte = params.horizonDays ?? 7;
  const desde = params.since ?? null;

  /*
   * O INSTANTE É LIDO ANTES DE TUDO, e da mesma transação.
   *
   * Ler no fim abriria uma janela: uma OS alterada durante as consultas
   * receberia um `updated_at` anterior ao `synced_at` devolvido, e a próxima
   * sincronização incremental a pularia — para sempre. Uma OS que nunca mais
   * atualiza é perda silenciosa de trabalho pelo outro lado.
   *
   * Ler no COMEÇO faz o pior caso ser mandar a mesma linha duas vezes, que o
   * aparelho resolve sobrescrevendo.
   */
  /*
   * O INSTANTE VEM COMO TEXTO ISO, FORMATADO PELO BANCO — e essa escolha
   * corrigiu um defeito real.
   *
   * A primeira versão pedia `now() AT TIME ZONE 'UTC'` e montava a cadeia em
   * JavaScript. O tipo devolvido por um timestamp sem fuso depende do driver:
   * um devolve texto, outro devolve `Date`. Concatenar 'Z' num `Date` produz o
   * `toString` dele — que NÃO TEM MILISSEGUNDOS —, e o `synced_at` saía
   * arredondado para o segundo.
   *
   * A consequência era silenciosa e cara: toda OS alterada nos milissegundos
   * seguintes ao arredondamento voltava em TODA sincronização incremental,
   * para sempre. O pacote "do que mudou" trazia o que não mudou, e ninguém
   * teria motivo para desconfiar.
   *
   * Com `to_char`, o formato é decidido pelo banco e é o mesmo em qualquer
   * driver. É a mesma razão pela qual o restante deste sistema não converte
   * tipo na fronteira.
   */
  const relogio = await s.query<{ agora: string }>(
    `SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS agora`
  );
  const agora = relogio[0]!.agora;

  const ordens = await s.query<Record<string, unknown>>(
    `SELECT w.id, w.number, w.title, w.description,
            w.status_category::text AS category, w.priority::text AS priority,
            w.customer_id, w.asset_id, w.location_id,
            w.location_name_snapshot, w.asset_name_snapshot,
            w.scheduled_start, w.scheduled_end, w.created_at, w.updated_at, w.version,
            st.key AS status_key, st.label AS status_label, st.color AS status_color,
            wr.key AS wait_reason_key, wr.label AS wait_reason_label
       FROM aurora.work_orders w
       JOIN aurora.work_order_statuses st ON st.id = w.status_id
       LEFT JOIN aurora.wait_reasons wr   ON wr.id = w.wait_reason_id
      WHERE w.assignee_membership_id = $1
        /*
         * ABERTAS SEM DATA ENTRAM SEMPRE.
         *
         * Filtrar só pela janela deixaria de fora a OS atrasada — a que está
         * aberta há três semanas sem agendamento. É exatamente a que o técnico
         * mais provavelmente vai tocar hoje, e a que mais dói não ter no
         * aparelho.
         */
        AND (
          w.scheduled_start IS NULL
          OR w.scheduled_start < now() + ($2 || ' days')::interval
        )
        AND w.status_category NOT IN ('closed', 'cancelled')
        AND ($3::timestamptz IS NULL OR w.updated_at > $3)
      ORDER BY w.scheduled_start NULLS LAST, w.created_at
      LIMIT 500`,
    [membershipId, String(horizonte), desde]
  );

  /*
   * OS ATIVOS SÃO OS DAS ORDENS **MAIS OS DOS LOCAIS DO DIA**, e não o cadastro
   * inteiro.
   *
   * A primeira versão trazia só os referenciados pelas ordens. A SPEC §20 pede
   * as duas coisas — "ativos referenciados por essas OS + ativos dos locais do
   * dia" — e a razão ficou óbvia quando a tela de leitura de etiqueta existiu:
   * o técnico aponta a câmera para um equipamento que NÃO tem ordem hoje,
   * justamente porque encontrou um problema nele. Sem o segundo conjunto, o
   * leitor responde "não encontrei" para todo equipamento do corredor que ele
   * está atravessando — e a tela de abrir chamado em campo perde o sentido.
   *
   * Uma prestadora com dez mil equipamentos continua não cabendo num celular. O
   * recorte é o ESCOPO DE LOCAIS do vínculo, que é o mesmo que limita tudo o
   * mais neste sistema, com teto explícito.
   */
  const idsDeAtivos = ordens.map((o) => o.asset_id).filter((x): x is string => typeof x === 'string');

  const ativos = await s.query<Record<string, unknown>>(
    /*
     * O FABRICANTE VEM PELO MODELO, e não do ativo.
     *
     * `assets` não tem `manufacturer_id`: o fabricante é atributo do
     * MODELO, e o ativo aponta para o modelo. Duplicá-lo no ativo faria
     * os dois divergirem na primeira correção de cadastro.
     */
    `SELECT a.id, a.tag, a.asset_number, a.name, a.serial_number,
                  a.status::text AS status, a.customer_id, a.location_id,
                  a.asset_category_id, a.asset_model_id, a.qr_token,
                  a.requires_calibration, a.requires_electrical_test,
                  a.notes, a.updated_at,
                  m.name AS manufacturer_name, mo.name AS model_name,
                  c.name AS category_name
             FROM aurora.assets a
             LEFT JOIN aurora.asset_models     mo ON mo.id = a.asset_model_id
             LEFT JOIN aurora.manufacturers    m  ON m.id  = mo.manufacturer_id
             LEFT JOIN aurora.asset_categories c  ON c.id  = a.asset_category_id
            WHERE a.deleted_at IS NULL
              AND (
                a.id = ANY($1::uuid[])
                OR a.location_id IN (SELECT location_id FROM aurora.accessible_location_ids($2))
              )
            ORDER BY a.name
            /*
             * O TETO É EXPLÍCITO, e é o que impede um escopo largo demais virar
             * um pacote que não desce numa rede de hospital. Quando ele for
             * atingido, o que falta continua alcançável pela busca com rede — e
             * o número está aqui para ser medido e ajustado com dado real, e não
             * escondido numa consulta sem limite.
             */
            LIMIT 2000`,
    [idsDeAtivos, membershipId]
  );

  // A árvore PODADA ao escopo, e não a árvore inteira: `accessible_location_ids`
  // é a mesma função que limita toda consulta deste sistema.
  const locais = await s.query<Record<string, unknown>>(
    `SELECT l.id, l.name, l.code, l.parent_id, l.customer_id, l.location_type_id,
            l.path, l.depth
       FROM aurora.locations l
      WHERE l.id IN (SELECT location_id FROM aurora.accessible_location_ids($1))
        AND l.deleted_at IS NULL
      ORDER BY l.path
      LIMIT 2000`,
    [membershipId]
  );

  /*
   * SÓ AS VERSÕES PUBLICADAS.
   *
   * Um rascunho de checklist no aparelho seria respondido em campo e depois
   * recusado na sincronização, porque rascunho não recebe resposta. O técnico
   * teria trabalhado à toa, e descobriria no estacionamento.
   */
  const modelos = await s.query<Record<string, unknown>>(
    `SELECT t.id, t.key, t.title, t.description, t.version, t.published_at,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', i.id, 'section_id', i.section_id, 'label', i.label,
                        'help_text', i.help_text, 'kind', i.kind::text,
                        'required', i.required, 'options', i.options,
                        'failing_options', i.failing_options,
                        'min_value', i.min_value, 'max_value', i.max_value,
                        'unit', i.unit, 'expected_boolean', i.expected_boolean,
                        'min_photos', i.min_photos,
                        'requires_photo_when', i.requires_photo_when::text,
                        'fail_action', i.fail_action::text,
                        'condition_item_id', i.condition_item_id,
                        'condition_equals', i.condition_equals,
                        'position', i.position)
                      ORDER BY i.position)
                 FROM aurora.checklist_items i
                WHERE i.template_id = t.id),
              '[]'::json
            ) AS items
       FROM aurora.checklist_templates t
      WHERE t.published_at IS NOT NULL
      ORDER BY t.title
      LIMIT 200`
  );

  // Os catálogos INTEIROS: são pequenos, e sem eles a tela mostra identificador
  // em vez de palavra. Baixá-los por demanda seria economizar quilobytes ao
  // preço de uma tela ilegível sem rede.
  const catalogos = await s.query<Record<string, unknown>>(
    `SELECT i.catalog_key, i.id, i.key, i.label, i.system_key, i.color, i.position
       FROM aurora.catalog_items i
      WHERE i.archived_at IS NULL
        AND i.merged_into_id IS NULL
      ORDER BY i.catalog_key, i.position
      LIMIT 2000`
  );

  const situacoes = await s.query<Record<string, unknown>>(
    `SELECT id, key, label, customer_label, category::text AS category, color, position,
            visible_on_board, requires_wait_reason
       FROM aurora.work_order_statuses
      WHERE archived_at IS NULL
      ORDER BY position`
  );

  /*
   * O GRAFO DE TRANSIÇÕES VAI JUNTO.
   *
   * Sem ele, a tela offline não sabe quais botões oferecer e só resta oferecer
   * todos — e aí metade das ações do dia volta como conflito. Mandar o grafo é
   * o que permite ao aparelho recusar na hora, quando a pessoa ainda está na
   * frente do equipamento e pode fazer outra coisa.
   */
  const transicoes = await s.query<Record<string, unknown>>(
    `SELECT de.key AS from_key, para.key AS to_key, t.permission_key,
            t.required_fields, t.note
       FROM aurora.work_order_status_transitions t
       JOIN aurora.work_order_statuses de   ON de.id   = t.from_status_id
       JOIN aurora.work_order_statuses para ON para.id = t.to_status_id
      ORDER BY de.position, para.position`
  );

  const motivos = await s.query<Record<string, unknown>>(
    `SELECT id, key, label, customer_label, pauses_sla, requires_note
       FROM aurora.wait_reasons
      WHERE archived_at IS NULL
      ORDER BY position`
  );

  /*
   * O SALDO É INDICATIVO, e a SPEC diz isso com todas as letras: "a confirmação
   * é no servidor".
   *
   * O técnico vê 3 filtros no almoxarifado às 8h; às 11h outra pessoa levou os
   * 3. Prometer o saldo faria o aparelho aceitar um consumo que o servidor vai
   * recusar — e a recusa chegaria horas depois, no estacionamento. O número
   * serve para ele saber o que PROVAVELMENTE tem, e nada mais.
   */
  const estoque = await s.query<Record<string, unknown>>(
    `SELECT b.item_id, b.warehouse_id, i.sku, i.name, i.unit,
            b.on_hand, b.reserved, w.name AS warehouse_name
       FROM aurora.stock_balances b
       JOIN aurora.inventory_items i ON i.id = b.item_id
       JOIN aurora.warehouses w      ON w.id = b.warehouse_id
      WHERE b.on_hand > 0
        AND i.archived_at IS NULL
      ORDER BY i.name
      LIMIT 1000`
  );

  return {
    // Já vem em ISO com milissegundos, do banco. Reprocessar em JavaScript foi
    // exatamente o que perdeu a precisão antes.
    synced_at: agora,
    incremental: desde !== null,
    work_orders: ordens,
    assets: ativos,
    locations: locais,
    checklist_templates: modelos,
    catalogs: catalogos,
    statuses: situacoes,
    transitions: transicoes,
    wait_reasons: motivos,
    stock: estoque,
    /*
     * As contagens existem para o aparelho DIZER o que baixou.
     *
     * "Sincronizado" sozinho não é informação: o técnico precisa poder olhar e
     * ver "12 OS, 9 equipamentos" antes de descer para o subsolo. Um pacote
     * vazio por engano parece igual a um pacote cheio quando a tela só diz
     * "pronto".
     */
    counts: {
      work_orders: ordens.length,
      assets: ativos.length,
      locations: locais.length,
      checklist_templates: modelos.length,
      catalogs: catalogos.length,
      stock: estoque.length,
    },
  };
}
