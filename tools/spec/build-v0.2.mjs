/**
 * Gera AURORA-CMMS-SPEC-v0.2.md a partir da v0.1, aplicando o hardening solicitado.
 * Cada patch é assertivo: se o anchor não for encontrado exatamente N vezes, o build falha.
 * Nunca "quase aplica" — ou o documento sai correto, ou não sai.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'docs', '02-AURORA-CMMS-SPEC', 'AURORA-CMMS-SPEC-COMPLETE.md');
const OUT = join(ROOT, 'docs', 'AURORA-CMMS-SPEC-v0.2.md');

let doc = readFileSync(SRC, 'utf8');
const applied = [];

function patch(id, from, to, expect = 1) {
  const count = doc.split(from).length - 1;
  if (count !== expect) {
    throw new Error(
      `[${id}] anchor encontrado ${count}x, esperado ${expect}x:\n---\n${from.slice(0, 160)}\n---`
    );
  }
  doc = doc.split(from).join(to);
  applied.push(`${id} (${expect}x)`);
}

/* ============================================================
   P00 — artefatos de conversão (**** duplicado)
   ============================================================ */
{
  const before = (doc.match(/\*\*\*\*/g) || []).length;
  doc = doc.replace(/\*\*\*\*([^*]+)\*\*\*\*/g, '**$1**');
  const after = (doc.match(/\*\*\*\*/g) || []).length;
  if (after !== 0) throw new Error(`P00: ainda restam ${after} artefatos ****`);
  applied.push(`P00 artefatos de negrito (${before / 2} ocorrências)`);
}

/* ============================================================
   P01 — contagem de personas
   ============================================================ */
patch(
  'P01-personas',
  'Oito personas, derivadas dos cargos reais observados na auditoria',
  'Dez personas (PER-01 a PER-10), derivadas dos cargos reais observados na auditoria'
);

/* ============================================================
   P02 — nomenclatura Core Operacional × MVP Comercial
   ============================================================ */
patch(
  'P02a-roadmap-marco',
  '| **▲ Fim do MVP operável — a partir daqui, expansão comercial** |   |   |   |   |',
  '| **▲ Fim do CORE OPERACIONAL (F0–F6) — o produto já opera um contrato real** |   |   |   |   |'
);

patch(
  'P02b-roadmap-marco-comercial',
  '| **F9** | Comercial |',
  '| **▲ Fim do MVP COMERCIAL (F0–F8) — o produto já pode ser vendido** |   |   |   |   |\n| **F9** | Comercial |'
);

patch(
  'P02c-matriz-criterio',
  'Critério agressivo: **CORE MVP** é o mínimo para operar um contrato real e cobrar por ele. Tudo que não passa nesse teste sai.',
  `Dois patamares distintos, deliberadamente separados — a confusão entre eles é a causa mais comum de escopo inflado:

| Patamar | Fases | Pergunta que responde | Critério de saída |
|---|---|---|---|
| **CORE OPERACIONAL** | F0–F6 | *A equipe consegue operar um contrato real só com isto?* | Um técnico executa uma OS de ponta a ponta, offline, com checklist e assinatura; um plano preventivo gera e mede o próprio ciclo |
| **MVP COMERCIAL** | F0–F8 | *Dá para vender e cobrar por isto?* | Core Operacional + indicadores que o gestor defende em reunião + portal que o cliente enxerga + notificações |
| **EXPANSÃO** | F9+ | *Dá para crescer o ticket?* | Comercial, metrologia, automação, integrações |

Regra: nada entra no Core Operacional por ser "importante". Entra por ser **indispensável para o trabalho acontecer**. Nada entra no MVP Comercial por ser bonito. Entra por ser **indispensável para o cliente perceber valor e pagar**.`
);

patch('P02d-classe-core', '| **CORE MVP**<br>F0–F6 |', '| **CORE OPERACIONAL**<br>F0–F6 |');
patch('P02e-classe-comercial', '| **MVP+**<br>F7–F8 |', '| **MVP COMERCIAL**<br>F7–F8 |');

// tabelas de métricas / recursos usam "MVP+" como marcador de coluna
{
  const n = (doc.match(/\| MVP\+ \|/g) || []).length;
  if (n < 5) throw new Error(`P02f: esperado >=5 marcadores "| MVP+ |", encontrado ${n}`);
  doc = doc.split('| MVP+ |').join('| Comercial |');
  applied.push(`P02f marcadores MVP+ → Comercial (${n}x)`);
}
patch(
  'P02g-legenda-metricas',
  'Analytics é funcionalidade de primeira classe, nativa, dentro do RBAC.',
  'Analytics é funcionalidade de primeira classe, nativa, dentro do RBAC. Na coluna de fase: **✔** = Core Operacional · **Comercial** = MVP Comercial (F7–F8) · **Fase 2/3** = expansão.'
);

/* ============================================================
   P03 — Open questions: classificação e defaults conservadores
   ============================================================ */
patch(
  'P03a-oq-preambulo',
  '## 46. Open questions\n',
  `## 46. Open questions

Cada questão é classificada segundo o efeito real sobre a implementação, e não segundo o quanto ainda não sabemos:

| Classe | Significado | Conduta |
|---|---|---|
| **A** | Já resolvida na própria SPEC | Seguir o que está escrito |
| **B** | Reversível | Adotar o *default conservador* registrado abaixo, documentar e seguir |
| **C** | Externa, mas não bloqueia o trabalho atual | Registrar e continuar por outro item |
| **D** | Irreversível **e** bloqueia a implementação corrente | Marcar BLOCKED, não inventar, seguir para trabalho independente |

> **DECISÃO v0.2**
>
> Nenhuma open question é classe **D**. As cinco que a v0.1 marcava como "Bloqueia MVP: Sim" foram reclassificadas com defaults conservadores explícitos, porque nenhuma delas impede escrever código correto — todas afetam configuração, conteúdo ou branding, camadas que já são isoladas por projeto.
`
);

patch(
  'P03b-oq01',
  '| OQ-01 | Vamos migrar dados do TechneCare/Arkmeds ou começar do zero? | Define se precisamos do assistente de migração de estados, do mapeamento de 651 tipos e da conciliação de indicadores históricos. Muda o escopo de F2 e F9 | Você / diretoria | **Sim** — decide o escopo de importação |',
  '| OQ-01 | Vamos migrar dados do TechneCare/Arkmeds ou começar do zero? | Define se precisamos do assistente de migração de estados legados e da conciliação de indicadores históricos | Você / diretoria | **B** — *default: começar do zero.* O importador genérico de planilha (EPIC-026) atende os dois casos; o assistente de migração de estados fica em F9 e não é dependência de nada em F0–F8 |'
);

patch(
  'P03c-oq03',
  '| OQ-03 | O primeiro cliente é prestadora multicliente ou departamento interno? | Define qual dos dois modos é polido primeiro e se o portal entra antes ou depois | Você | **Sim** |',
  '| OQ-03 | O primeiro cliente é prestadora multicliente ou departamento interno? | Define qual modo é polido primeiro | Você | **B** — *default: construir para prestadora multicliente.* É o superset: exercita `customer`, escopo, portal e contrato. O modo interno é o mesmo código com `customer.is_internal = true` e *single-customer mode* na interface (ADR-004), logo construir o superset nunca é retrabalho |'
);

patch(
  'P03d-oq06',
  '| OQ-06 | Quais estados o cliente piloto realmente usa hoje? | Valida o mapeamento 42 → 9+14. Se aparecer um caso que não cabe, a categoria precisa ser revista **antes** de F3 | Coordenador do piloto | **Sim** |',
  '| OQ-06 | Quais estados o cliente piloto realmente usa hoje? | Valida o mapeamento 42 → 9 situações + 14 motivos | Coordenador do piloto | **C** — não bloqueia. Situações e motivos são **catálogo por organização** (§10); as 9 categorias são fixas e cobrem os 42 estados auditados um a um. Validar antes de F3 **entrar em produção**, não antes de implementar |'
);

patch(
  'P03e-oq13',
  '| OQ-13 | Qual o nome definitivo do produto e o domínio? | Afeta identidade visual, e-mails transacionais, PWA e URLs | Você | Não |',
  '| OQ-13 | Qual o nome definitivo do produto e o domínio? | Afeta identidade visual, e-mails transacionais, PWA e URLs | Você | **B** — *default: `Aurora` é o nome de trabalho oficial.* Namespace técnico `aurora` (pacotes, prefixo de variáveis de sessão, chaves de config). Marca, domínio e textos visíveis ficam concentrados em `packages/config` para que a troca seja uma alteração de configuração, não uma refatoração |'
);

patch(
  'P03f-oq15',
  '| OQ-15 | Onde hospedar (região, provedor) e há exigência de dado em território nacional? | Afeta latência, custo e conformidade contratual com hospitais públicos | Você / jurídico | **Sim** — decide F0 |',
  '| OQ-15 | Onde hospedar (região, provedor) e há exigência de dado em território nacional? | Afeta latência, custo e conformidade contratual com hospitais públicos | Você / jurídico | **B** — *default: região brasileira (`sa-east-1`) e dado em território nacional.* Nenhuma linha de código pode depender de região ou provedor: banco por `DATABASE_URL`, arquivos por adaptador S3-compatível, identidade por `AuthProvider`. A escolha é de infraestrutura, não de arquitetura |'
);

patch(
  'P03g-oq-bloqueia',
  '| # | Pergunta | Impacto | Quem responde | Bloqueia MVP? |',
  '| # | Pergunta | Impacto | Quem responde | Classe e conduta |'
);

/* ============================================================
   P04 — hardening de banco: roles, FORCE RLS, pool, UUID, numeração
   ============================================================ */
patch(
  'P04a-camada-rls',
  '| 4 | **RLS no Postgres** | Política em toda tabela de negócio comparando `organization_id` com a variável de sessão definida na abertura da conexão | Bug na aplicação, injeção, acesso direto ao banco |',
  '| 4 | **RLS no Postgres** | `ENABLE` **e** `FORCE ROW LEVEL SECURITY` em toda tabela de negócio, com política comparando `organization_id` à variável **transaction-local** `aurora.organization_id`. O papel usado pela API não é dono das tabelas e não tem `BYPASSRLS` | Bug na aplicação, injeção, acesso direto ao banco, consulta esquecida |'
);

patch(
  'P04b-hardening-secao',
  '### Regras adicionais\n\n- **Chave de serviço nunca sai do servidor.**',
  `### Hardening de banco — obrigatório desde a primeira migration

#### Papéis de banco separados

| Papel | Usado por | Privilégios | Nunca |
|---|---|---|---|
| \`aurora_owner\` | Dono do schema e das tabelas | \`OWNER\` de tudo; alvo das migrations | Ser usado pela API em runtime |
| \`aurora_migrator\` | Pipeline de migrations | \`SET ROLE aurora_owner\`; DDL | Rodar em processo de requisição |
| \`aurora_app\` | **A API, em runtime** | \`SELECT/INSERT/UPDATE/DELETE\` nas tabelas de negócio, conforme as policies | Ser owner · ter \`BYPASSRLS\` · ter \`SUPERUSER\` · ter DDL |
| \`aurora_readonly\` | Analytics e suporte | \`SELECT\` sujeito a RLS | Escrever |

Regra estrutural: **o dono da tabela ignora RLS por padrão no PostgreSQL.** Por isso duas coisas são obrigatórias e não opcionais: (1) \`ALTER TABLE … FORCE ROW LEVEL SECURITY\`, que submete inclusive o owner às policies; (2) \`aurora_app\` **não** ser o owner. Uma sem a outra deixa uma porta aberta.

\`\`\`sql
-- padrão aplicado a TODA tabela tenant-scoped
ALTER TABLE <t> ENABLE  ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE   ROW LEVEL SECURITY;

CREATE POLICY <t>_tenant_isolation ON <t>
  USING      (organization_id = aurora.current_organization_id())
  WITH CHECK (organization_id = aurora.current_organization_id());
\`\`\`

A função \`aurora.current_organization_id()\` é \`STABLE\`, marcada \`SECURITY INVOKER\`, e lê a variável transaction-local. Se a variável não estiver definida, **retorna NULL** — e a comparação \`organization_id = NULL\` é falsa, de modo que a ausência de contexto **fecha o acesso** em vez de abri-lo. Falha fechada, nunca aberta.

#### Contexto transaction-local e reuso de pool

O contexto **nunca** é definido com \`SET\`, apenas com \`set_config(..., is_local => true)\`, dentro da transação:

\`\`\`sql
SELECT set_config('aurora.organization_id', $1, true);  -- true = transaction-local
SELECT set_config('aurora.actor_id',        $2, true);
SELECT set_config('aurora.request_id',      $3, true);
\`\`\`

Motivo: com \`pgBouncer\`/pool de conexões, uma variável de **sessão** sobrevive ao \`COMMIT\` e volta para o pool junto com a conexão — o próximo tenant herdaria o contexto do anterior. Variável transaction-local morre no \`COMMIT\`/\`ROLLBACK\`.

Consequências de projeto, todas obrigatórias:

- **Nenhuma consulta de negócio fora de transação.** O repositório só expõe execução dentro de uma unidade de trabalho que abriu o contexto.
- **Toda transação abre definindo o contexto**; não existe caminho que consulte tabela tenant-scoped sem ele.
- **Teste obrigatório de reuso de pool** (\`EPIC-001\`): tenant A executa uma requisição, a conexão volta ao pool, tenant B reutiliza **a mesma conexão física** e o teste afirma \`current_setting('aurora.organization_id', true) IS NULL\` no início e que B não enxerga nenhuma linha de A.
- **Teste obrigatório de falha fechada**: consulta a tabela tenant-scoped **sem** contexto definido retorna zero linhas — nunca todas.

#### Espaços de numeração — três, e nunca se misturam

| Espaço | Para quê | Formato | Quem gera | Visível ao usuário |
|---|---|---|---|---|
| **Identificador técnico** | Chave primária e referência entre tabelas | \`uuid v7\` | Aplicação, na criação | Não — nunca em URL de negócio como identificador semântico |
| **Número de documento de trabalho** | OS e solicitação | \`number_series\` (prefixo + sequência) | Servidor, transacional | Sim |
| **Número de documento emitido** | Certificado, laudo, orçamento, contrato | \`number_series\` própria por \`document_type\` | Servidor, transacional | Sim, e com valor legal |

Regras: uma série **nunca** é compartilhada entre espaços; número alocado **nunca** é reaproveitado (documento cancelado mantém o número queimado com o motivo); a alocação usa *advisory lock* na mesma transação do registro, de modo que não existe número sem registro nem registro sem número; e o cliente **nunca** gera número — OS criada offline recebe identificador técnico local e o número definitivo na sincronização.

#### UUID v7 — uma única implementação

\`uuid v7\` é ordenável por tempo, o que evita fragmentação de índice B-tree em tabelas de alto volume (OS, eventos, auditoria). Decisões:

- **Uma única fábrica**, exportada por \`packages/domain\`, usada por todos os módulos e por todos os *seeds*. Nenhum módulo importa biblioteca de UUID diretamente.
- **Geração na aplicação**, não no banco. \`gen_random_uuid()\` é v4 e não ordena; \`uuidv7()\` nativo só existe a partir do PostgreSQL 18 e o alvo é 16+. Depender dele quebraria o ambiente de destino.
- A coluna é \`uuid\` puro; o banco **não** tem \`DEFAULT\` de geração para chaves de negócio, justamente para que uma inserção sem id falhe alto em vez de gerar um v4 silencioso.
- A fábrica é testada quanto a monotonicidade dentro do mesmo milissegundo e quanto ao formato (versão 7, variante RFC 9562).

### Regras adicionais

- **Chave de serviço nunca sai do servidor.**`
);

/* ============================================================
   P05 — convenções do modelo de dados (§32)
   ============================================================ */
patch(
  'P05-convencoes',
  'Convenções obrigatórias, aplicadas sem exceção: chave primária `uuid v7`;',
  'Convenções obrigatórias, aplicadas sem exceção: chave primária `uuid v7` gerada pela fábrica única de `packages/domain` (§37);'
);

/* ============================================================
   P06 — NFR: novas linhas de segurança
   ============================================================ */
patch(
  'P06-nfr',
  '| **Segurança** | Sessão | Expiração por inatividade (staff 12 h, portal 30 dias); revogação imediata ao remover vínculo | Teste de integração |',
  `| **Segurança** | Sessão | Expiração por inatividade (staff 12 h, portal 30 dias); revogação imediata ao remover vínculo | Teste de integração |
| **Segurança** | Papel de banco da API | Sem \`BYPASSRLS\`, sem \`SUPERUSER\`, não é owner das tabelas tenant-scoped | Teste que consulta \`pg_roles\` e \`pg_class.relowner\` e falha se violado |
| **Segurança** | \`FORCE ROW LEVEL SECURITY\` | Ativo em 100 % das tabelas tenant-scoped | Teste que varre \`pg_class\` e falha se alguma tabela tiver \`relforcerowsecurity = false\` |
| **Segurança** | Contexto transaction-local | Zero vazamento de contexto entre requisições que compartilham conexão | Teste de reuso de pool (A → devolve → B) |
| **Segurança** | Falha fechada | Consulta sem contexto de tenant retorna zero linhas | Teste de integração no banco |`
);

/* ============================================================
   P07 — EPIC-001 expandido
   ============================================================ */
patch(
  'P07-epic001',
  `**Escopo**

- Esquema base com \`organization_id\` e convenções da §32
- Contexto de requisição propagado (organização, membership, permissões, escopo, request_id)
- Construtor de consultas com injeção automática de tenant e \`unsafeCrossTenant()\` barrado por lint
- RLS em todas as tabelas de negócio
- *Trigger* de auditoria genérico com diff
- Outbox de eventos de domínio
- Fila de jobs, migrações versionadas, seeds, ambientes, CI com a suíte de isolamento`,
  `**Escopo**

*Monorepo e tooling*
- Monorepo com workspaces, gerenciador de pacotes fixado e *lockfile* versionado
- TypeScript \`strict\` em todos os pacotes, com \`noUncheckedIndexedAccess\`
- Lint, formatter e regra de lint própria barrando \`unsafeCrossTenant\` fora de \`tools/\`
- CI executando typecheck, lint, testes e build
- Configuração de ambientes com validação de segredos no *boot* (falha alto se faltar variável)

*Banco*
- Schema PostgreSQL com \`organizations\`, \`users\`, \`memberships\`, \`membership_scopes\`
- Migrations versionadas, reprodutíveis do zero, com teste de "banco vazio → migrations → seeds → testes"
- Papéis \`aurora_owner\`, \`aurora_migrator\`, \`aurora_app\`, \`aurora_readonly\` (§37)
- \`ENABLE\` + \`FORCE ROW LEVEL SECURITY\` e policy de isolamento em toda tabela tenant-scoped
- \`aurora.current_organization_id()\` com falha fechada
- Drizzle como camada de acesso, com repositórios que só operam dentro de unidade de trabalho

*Plataforma*
- \`RequestContext\` resolvido **no servidor** (organização, membership, ator, permissões, escopo, \`request_id\`)
- \`AuthProvider\` como porta; implementação concreta isolada em infraestrutura
- \`audit_logs\` por *trigger*, com antes/depois, ator, tipo de ator, IP, agente, origem e \`request_id\`
- \`domain_events\` com *outbox* transacional (evento e dado na mesma transação)
- pg-boss para jobs, com enfileiramento transacional
- Tratamento de erro padronizado (\`code\`, \`message\`, \`details\`, \`request_id\`), sem *stack trace* para o cliente
- Logs estruturados correlacionados por \`request_id\`
- Endpoints de saúde (*liveness* e *readiness*)
- OpenAPI inicial gerado a partir dos esquemas de validação
- Fábrica única de \`uuid v7\`

*Testes*
- Unitários do domínio puro
- Integração de banco com migrations reais
- **Suíte de isolamento cross-tenant reutilizável** (A/B) aplicável a qualquer recurso
- Teste de reuso de pool, de falha fechada e de configuração de papéis`
);

/* ============================================================
   P08 — novos ADRs
   ============================================================ */
patch(
  'P08-adrs',
  '| ADR-020 | Taxonomia de falha |',
  `| ADR-021 | Gerenciador de pacotes | (a) pnpm; (b) yarn; (c) npm workspaces | **(c)** | \`pnpm\` e \`corepack\` não estão disponíveis no ambiente de desenvolvimento atual e instalar um gerenciador global adiciona uma dependência de máquina que o CI teria de replicar. \`npm workspaces\` é nativo do Node 25, suficiente para este monorepo e mantém um único \`package-lock.json\` versionado. Reversível: migrar para pnpm depois é troca de lockfile, não de arquitetura |
| ADR-022 | Banco para testes automatizados | (a) Postgres em Docker; (b) Postgres remoto; (c) PGlite (Postgres em WASM, em processo) | **(c)** como padrão, **(a)** opcional via \`AURORA_TEST_PG_URL\` | O daemon do Docker não está disponível no ambiente atual e o banco remoto está bloqueado (ADR-025). PGlite é PostgreSQL real, roda em processo, suporta RLS, papéis e \`set_config\`, e torna o teste de vazamento de contexto **mais** adversarial: como há uma única conexão persistente, qualquer contexto que vazasse apareceria imediatamente. O teste de pool com várias conexões físicas roda quando um Postgres real é apontado por variável de ambiente |
| ADR-023 | Isolamento no banco | (a) só filtro na aplicação; (b) RLS com owner; (c) RLS + \`FORCE\` + papel não-owner sem \`BYPASSRLS\` | **(c)** | O owner ignora RLS por padrão; sem \`FORCE\` e sem separação de papéis, a política é decorativa. Detalhes em §37 |
| ADR-024 | Geração de identificador | (a) \`gen_random_uuid()\` no banco; (b) \`uuidv7()\` nativo; (c) fábrica única na aplicação | **(c)** | v4 não ordena e fragmenta índice; \`uuidv7()\` nativo só existe no PostgreSQL 18 e o alvo é 16+. Fábrica única, testada, exportada por \`packages/domain\` |
| ADR-025 | Uso do Supabase remoto nesta fase | (a) aplicar migrations no projeto remoto; (b) desenvolver localmente | **(b)** — remoto **bloqueado** | Não foi possível **confirmar tecnicamente** qual projeto Supabase pertence ao Aurora: a conta autenticada lista 28 projetos em ~15 organizações, nenhum identificável como Aurora. A instrução vigente é explícita: havendo qualquer possibilidade de apontar para outro projeto, não executar operação remota. Toda a base é desenvolvida como migrations locais, reprodutíveis, e será aplicada ao projeto correto quando ele for identificado por *ref* |
| ADR-020 | Taxonomia de falha |`
);

/* ============================================================
   P09 — changelog v0.2 no topo
   ============================================================ */
patch(
  'P09-changelog',
  '## 01. Visão do produto\n',
  `## 00. Changelog — v0.1 → v0.2

Esta é a **v0.2**, e é a *source of truth* corrente. A v0.1 permanece em \`docs/02-AURORA-CMMS-SPEC/\` como registro histórico.

| # | Correção | Onde | Motivo |
|---|---|---|---|
| 1 | Contagem de personas corrigida de "oito" para **dez** (PER-01 a PER-10) | §02 | O texto contradizia a própria lista |
| 2 | Separação explícita **Core Operacional (F0–F6)** × **MVP Comercial (F0–F8)** | §38, §44, §25 | "MVP" significava duas coisas diferentes em seções diferentes |
| 3 | OQ-01, OQ-03, OQ-06, OQ-13 e OQ-15 reclassificadas com *defaults* conservadores | §46 | Estavam marcadas como bloqueantes sem de fato bloquear a escrita de código |
| 4 | Classificação A/B/C/D das open questions | §46 | Faltava critério para decidir quando parar e quando seguir |
| 5 | Hardening de RLS: \`FORCE ROW LEVEL SECURITY\` obrigatório | §37, §34 | Sem \`FORCE\`, o owner da tabela ignora a política |
| 6 | Papéis de banco separados (\`owner\`/\`migrator\`/\`app\`/\`readonly\`) | §37 | O papel da API não pode ser owner nem ter \`BYPASSRLS\` |
| 7 | Contexto **transaction-local** e teste obrigatório de reuso de pool | §37, §34 | Variável de sessão sobrevive ao \`COMMIT\` e vaza entre tenants no pool |
| 8 | Falha fechada sem contexto de tenant | §37, §34 | Ausência de contexto tem de negar acesso, não liberar tudo |
| 9 | \`uuid v7\` com fábrica única na aplicação | §32, §37, ADR-024 | Evita v4 silencioso e dependência de função inexistente no PostgreSQL 16/17 |
| 10 | Três espaços de numeração formalmente separados | §37 | Identificador técnico, número de OS e número de documento não podem compartilhar série |
| 11 | EPIC-001 expandido para escopo verificável | §39 | O escopo anterior era resumido demais para servir de contrato de implementação |
| 12 | ADR-021 a ADR-025 | §45 | Gerenciador de pacotes, banco de testes, isolamento, identificadores e bloqueio do Supabase remoto |
| 13 | Artefatos de conversão \`****\` corrigidos | vários | Ruído da conversão HTML → Markdown |

> **BLOQUEIO EXTERNO REGISTRADO**
>
> O projeto Supabase do Aurora **não pôde ser identificado**. A conta autenticada no CLI lista 28 projetos em cerca de 15 organizações, nenhum com nome compatível com Aurora, e nenhum vinculado (\`linked: false\`). Conforme a regra vigente, nenhuma operação remota foi executada. O desenvolvimento segue integralmente local, com migrations reprodutíveis, prontas para serem aplicadas ao projeto correto assim que o *project ref* for informado. Ver ADR-025 e §46 OQ-16.

## 01. Visão do produto
`
);

/* ============================================================
   P10 — OQ-16 (identificação do projeto Supabase)
   ============================================================ */
patch(
  'P10-oq16',
  '## 47. Anti-patterns do sistema de referência',
  `| OQ-16 | Qual é o **project ref** do projeto Supabase do Aurora? | Nenhuma operação remota pode ser executada sem essa confirmação. Não afeta o código: migrations, seeds e testes rodam localmente | Você | **C** — não bloqueia o desenvolvimento; **bloqueia apenas a aplicação remota**. Ver ADR-025 |

## 47. Anti-patterns do sistema de referência`
);

/* ============================================================
   P12 — classificação A/B/C/D das demais open questions
   ============================================================ */
const oqClasses = [
  [
    'OQ-02',
    'Fornecedor Arkmeds | Não, mas bloqueia F7 |',
    'Fornecedor Arkmeds | **C** — externa e não bloqueia. O catálogo de métricas é construído com definições próprias e visíveis (§25). Conciliar com o sistema antigo é tarefa de migração, não de plataforma |',
  ],
  [
    'OQ-04',
    'Cliente piloto | Não |',
    'Cliente piloto | **B** — *default: metrologia permanece em F10.* O motor de documentos é genérico (§18), então antecipar é adicionar um `document_type`, não remodelar |',
  ],
  [
    'OQ-05',
    'Cliente piloto | Não |',
    'Cliente piloto | **B** — *default: dimensionar para o volume observado na auditoria* (27 mil ativos e 74 mil OS por organização) e validar com seeds de escala crescente. Réplica de leitura fica fora do Core Operacional |',
  ],
  [
    'OQ-07',
    'Comercial / jurídico | Não — é configurável |',
    'Comercial / jurídico | **A** — já resolvida na SPEC: o padrão de fábrica é **não pausar**, e `wait_reason.pauses_sla` é configurável por organização (§10) |',
  ],
  [
    'OQ-08',
    'Responsável técnico / jurídico | Não, mas modelar já |',
    'Responsável técnico / jurídico | **B** — *default: assinatura eletrônica simples com hash de conteúdo e trilha.* O campo `method` já prevê `icp_brasil` (§18); adicionar o provedor é aditivo, não migratório. **Não afirmamos validade jurídica** — isso depende de parecer externo |',
  ],
  [
    'OQ-09',
    'Você / cliente | Não, mas afeta o modelo |',
    'Você / cliente | **B** — *default: não integrar agora, mas reservar o campo.* `external_id` (nullable, único por organização + sistema de origem) entra em `customers`, `assets`, `work_orders` e `inventory_items` desde F2: custo desprezível agora, migração cara depois |',
  ],
  [
    'OQ-10',
    'Você | Não |',
    'Você | **C** — externa e não bloqueia. Instrumentar telemetria de assentos, ativos e OS desde F0 mantém qualquer modelo de cobrança viável |',
  ],
  [
    'OQ-11',
    'Você / cliente piloto | Não |',
    'Você / cliente piloto | **B** — *default: fora do Core Operacional.* O canal fica atrás da abstração de notificação (§23); adicionar WhatsApp é implementar um adaptador, não mudar o roteador |',
  ],
  [
    'OQ-12',
    'Cliente piloto | Não |',
    'Cliente piloto | **C** — módulo regulado próprio, fora do escopo atual. Não impacta o modelo de dados |',
  ],
  [
    'OQ-14',
    'Você | Não |',
    'Você | **C** — não bloqueia. `checklist_item.kind = auto_test` já está previsto (§14) e a importação por arquivo ou API é aditiva |',
  ],
];
oqClasses.forEach(([id, from, to]) => {
  const line = doc.split('\n').find((l) => l.startsWith(`| ${id} |`));
  if (!line) throw new Error(`P12: linha de ${id} não encontrada`);
  if (!line.endsWith(from)) throw new Error(`P12: fim inesperado em ${id}:\n${line.slice(-120)}`);
  const replaced = line.slice(0, line.length - from.length) + to;
  doc = doc.split(line).join(replaced);
  applied.push(`P12-${id}`);
});

/* ============================================================
   P13 — external_id nas convenções (default de OQ-09)
   ============================================================ */
patch(
  'P13-external-id',
  'toda enumeração estrutural (categorias de situação, tipos de movimento) é `enum` de banco.',
  'toda enumeração estrutural (categorias de situação, tipos de movimento) é `enum` de banco; entidades que um ERP externo pode espelhar (`customers`, `assets`, `work_orders`, `inventory_items`) carregam `external_id` e `external_source`, ambos anuláveis, com unicidade por (`organization_id`, `external_source`, `external_id`) — reservados desde já para não exigir migração quando houver integração (OQ-09).'
);

/* ============================================================
   P14 — rastreabilidade: épicos com identificador completo
   ============================================================ */
{
  const roadmapCells = [
    ['001, 022 (parcial)', 'EPIC-001, EPIC-022 (parcial)'],
    ['002, 003, 004', 'EPIC-002, EPIC-003, EPIC-004'],
    ['005, 006, 026 (ativos)', 'EPIC-005, EPIC-006, EPIC-026 (ativos)'],
    ['007, 008, 009', 'EPIC-007, EPIC-008, EPIC-009'],
    ['011, 014', 'EPIC-011, EPIC-014'],
    ['010, 012', 'EPIC-010, EPIC-012'],
    ['021, 025', 'EPIC-021, EPIC-025'],
    ['020, 023', 'EPIC-020, EPIC-023'],
    ['015, 016, 017', 'EPIC-015, EPIC-016, EPIC-017'],
    ['018, 019', 'EPIC-018, EPIC-019'],
    ['024, 027, 021 (avançado)', 'EPIC-024, EPIC-027, EPIC-021 (avançado)'],
  ];
  roadmapCells.forEach(([f, t]) => patch(`P14-roadmap-${f.slice(0, 3)}`, `| ${f} |`, `| ${t} |`));
  patch(
    'P14-roadmap-013',
    '| Planos com tarefas, ciclos, geração automática de OS e conformidade | 013 |',
    '| Planos com tarefas, ciclos, geração automática de OS e conformidade | EPIC-013 |'
  );

  // tabela "Demais épicos": | **004** Catálogos… -> | **EPIC-004** — Catálogos…
  const before = doc;
  doc = doc.replace(/^\| \*\*(\d{3})\*\* ([^|]+)\|/gm, (_m, n, rest) => `| **EPIC-${n}** — ${rest.trim()} |`);
  const n = (before.match(/^\| \*\*\d{3}\*\* /gm) || []).length;
  if (n < 15) throw new Error(`P14: esperado >=15 linhas na tabela de épicos, encontrado ${n}`);
  applied.push(`P14 tabela de épicos (${n} linhas)`);
}

/* ============================================================
   P15 — ADR-026/027: sem dependência de extensão do PostgreSQL

   Descoberto na implementação do EPIC-003: `ltree` e `pg_trgm` não existem
   no PGlite (banco dos testes, ADR-022) e não são garantidos em PostgreSQL
   gerenciado. A v0.1 assumia as duas extensões. Corrigido aqui, com ADR.
   ============================================================ */
patch(
  'P15-adr026',
  '| ADR-021 | Gerenciador de pacotes |',
  '| ADR-026 | Representação da árvore de locais | (a) `ltree`; (b) caminho materializado em `text`; (c) tabela de fechamento | **(b)** | `ltree` é extensão, e extensão nem sempre está disponível: não existe no PGlite (ADR-022) e vários PostgreSQL gerenciados restringem quais podem ser criadas. Um caminho materializado `/uuid/uuid/` com índice `text_pattern_ops` responde consulta de subárvore por prefixo usando índice, funciona em qualquer PostgreSQL sem extensão e tem a mesma complexidade de leitura. O custo é reescrever prefixos ao mover subárvore — operação rara, já transacional, e que o modelo previa. Tabela de fechamento foi recusada por multiplicar linhas sem ganho na profundidade máxima de 8. **Consequência:** onde a v0.1 diz `ltree`, leia-se caminho materializado em `text` |\n' +
    '| ADR-027 | Busca textual | (a) `pg_trgm` + `tsvector`; (b) só `tsvector` nativo; (c) motor dedicado | **(b)** no núcleo, **(a)** como otimização opcional | Mesma razão do ADR-026: `pg_trgm` é extensão e não é garantida; `tsvector`/`to_tsquery` são nativos. A tolerância a erro de digitação em série e patrimônio (§27) passa a ser obtida por normalização na indexação — o índice guarda a forma sem pontuação, sem acento e em caixa baixa — e o trigrama entra como aceleração onde o ambiente permitir. A degradação é de qualidade de resultado, não de funcionalidade |\n' +
    '| ADR-021 | Gerenciador de pacotes |'
);

/* coerência das seções afetadas pelo ADR-026/027 */
patch('P15a', '| `path` | ltree | **Materializado**', '| `path` | text | **Materializado**');
patch('P15b', '`location_path` (ltree) + escopo', '`location_path` (caminho materializado) + escopo');
patch('P15c', 'path ltree, depth', 'path text, depth');
patch(
  'P15d',
  'customers ─1:N─ locations (self-FK, ltree path)',
  'customers ─1:N─ locations (self-FK, caminho materializado)'
);
patch(
  'P15e',
  'Postgres com `ltree` + escopo materializado',
  'Postgres com caminho materializado + escopo materializado (ADR-026)'
);
patch('P15f', 'Tipos de local e árvore com ltree', 'Tipos de local e árvore com caminho materializado');
patch('P15g', '**(c)** com `ltree`', '**(c)** com caminho materializado (ADR-026)');
patch(
  'P15h',
  'PostgreSQL 16+ com `ltree`, `pg_trgm`, `uuid v7`',
  'PostgreSQL 16+ sem dependência de extensão (ADR-026, ADR-027), `uuid v7` gerado na aplicação'
);
patch(
  'P15i',
  'GiST em `locations.path` + tabela materializada de locais acessíveis',
  'B-tree `text_pattern_ops` em `locations.path` (subárvore por prefixo) + tabela materializada de locais acessíveis'
);
patch(
  'P15j',
  '`tsvector` gerado + GIN; `pg_trgm` em série, TAG e patrimônio',
  '`tsvector` gerado + GIN; forma normalizada indexada em série, TAG e patrimônio (`pg_trgm` opcional, ADR-027)'
);

/* ============================================================
   P17 — ADR-028: catálogos planos em uma tabela só

   Decisão tomada na implementação do EPIC-004. Precisa estar na SPEC porque
   renomeia tabelas que a v0.1 nomeava separadamente.
   ============================================================ */
patch(
  'P17-adr028',
  '| ADR-026 | Representação da árvore de locais |',
  '| ADR-028 | Catálogos planos | (a) uma tabela por catálogo (`work_order_types`, `failure_codes`, `rejection_reasons`…); (b) uma tabela `catalog_items` com discriminador `catalog_key`; (c) EAV genérico | **(b)** | Os catálogos planos têm exatamente a mesma forma — chave técnica, rótulo, posição, cor, arquivado, mesclado — e nenhum deles tem campo próprio. Uma tabela por catálogo multiplicaria por seis o mesmo esquema, a mesma RLS, o mesmo gatilho de auditoria e a mesma função de mesclagem, e cada catálogo novo exigiria migration. **Isto não é a `Empresa` polimórfica da referência:** lá, conceitos com atributos e relacionamentos DIFERENTES foram forçados numa tabela, e por isso nenhum podia ter campo próprio. A regra aqui é o inverso e é explícita: mesma forma, mesma tabela; forma diferente, tabela diferente. Quem tem campo próprio continua separado — `customers`, `locations`, `suppliers`, e no EPIC-005 `manufacturers`, `asset_models`, `criticality_levels`. **Consequência:** onde a v0.1 nomeia `work_order_types`, `failure_codes` e `rejection_reasons`, leia-se `catalog_items` com o `catalog_key` correspondente. `wait_reasons` **permanece tabela própria**, por ter `pauses_sla` e responsável — campos que os demais não têm |\n' +
    '| ADR-026 | Representação da árvore de locais |'
);

/* ============================================================
   P18 — dois eventos de contrato que faltavam no catálogo

   Encontrado ao implementar o EPIC-017. O §17 pede alerta de vencimento e
   trata encerramento como fato de negócio, mas o catálogo de eventos só
   declarava `contract.activated`, `contract.expiring` e
   `contract.period_closed`. Sem `contract.expired`, "vai vencer" e "venceu"
   seriam o mesmo evento — e quem assina notificação não teria como distinguir
   o aviso da consequência. Sem `contract.terminated`, o encerramento por
   decisão humana só existiria na trilha de auditoria, invisível a qualquer
   automação.
   ============================================================ */
patch(
  'P18-eventos-contrato',
  '`contract.activated` · `contract.expiring` · `contract.period_closed`',
  '`contract.activated` · `contract.expiring` · `contract.expired` · `contract.terminated` · `contract.period_closed`'
);

/* ============================================================
   P19 — ausências: o tipo "absence" não existe no esquema

   Encontrado ao implementar o EPIC-013. O §13 e o dicionário de dados falam em
   bloco "de tipo `absence`", mas o enumerado criado no EPIC-003 é
   `vacation | leave | training | other` — e é ele que está no banco desde a
   migration 0008. Deixar a SPEC descrevendo um valor que não existe faria o
   próximo leitor procurar por ele.

   A regra de bloqueio passa a ser dita pelo que existe: férias e afastamento
   BLOQUEIAM (a pessoa não está disponível de forma alguma); treinamento e
   "outros" — que abrigam reunião e reserva de sala — AVISAM, porque a pessoa
   está presente e alguém pode legitimamente decidir o contrário.

   O vínculo também é corrigido: o bloco aponta para o VÍNCULO
   (`membership_id`), não para o usuário, porque a mesma pessoa pode ter
   vínculo em duas organizações e as férias são de um deles.
   ============================================================ */
patch(
  'P19-dicionario-ausencias',
  'user_id ou team_id, kind(absence\\|training\\|meeting\\|other), starts_at, ends_at, note | N:1 user/team | Bloqueia agendamento quando `absence`',
  'membership_id, kind(vacation\\|leave\\|training\\|other), starts_at, ends_at, note | N:1 membership | Bloqueia agendamento em `vacation` e `leave`; avisa em `training` e `other`'
);
patch(
  'P19-regra-ausencias',
  '**Bloqueio**. Agendar sobre um `availability_block` de tipo `absence` é recusado',
  '**Bloqueio** em `vacation` e `leave` — a pessoa não está disponível de forma alguma. **Aviso** em `training` e `other`: há compromisso, mas a pessoa está presente e o coordenador pode decidir o contrário'
);

/* ============================================================
   cabeçalho de versão
   ============================================================ */
patch(
  'P11-cabecalho',
  '# Aurora — plataforma de gestão de ativos e manutenção',
  '# Aurora — plataforma de gestão de ativos e manutenção\n\n**Especificação funcional e arquitetural · v0.2 · SOURCE OF TRUTH**'
);

/* ============================================================
   saída
   ============================================================ */
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, doc, 'utf8');

console.log('patches aplicados:');
applied.forEach((a) => console.log('  ✓ ' + a));
console.log(`\n${OUT}`);
console.log(
  `  ${doc.length} chars · ${doc.split('\n').length} linhas · ${(doc.match(/^## /gm) || []).length} seções`
);
