# Relatório — AI-HANDOFF e login real

**Data:** 29 de setembro de 2026
**Repositório:** `voceconectadigital/technecaremeds` — nome preservado
**Frente:** documentação canônica de continuidade + acesso real ao sistema

---

## Resumo em três frases

O sistema passou a ter **login de verdade**: senha própria em `scrypt`, sessão
como token opaco revogável, e uma conta administrativa que atravessa RBAC e RLS
como qualquer outra — **verificada no navegador**, tela por tela, do login ao
logout. No caminho, três defeitos reais apareceram e foram corrigidos, sendo o
mais grave uma variável de configuração de segurança que **existia, era validada
e ninguém lia**: definir `AURORA_AUTH_PROVIDER=supabase` fazia o boot passar e o
processo continuava aceitando entrada **sem senha**. O `docs/AI-HANDOFF.md` foi
escrito como documento canônico de continuidade, com 37 seções, e todos os
portões de qualidade estão verdes.

---

## 1 · AI-HANDOFF

**Arquivo:** `docs/AI-HANDOFF.md` · **37 seções** · ~1 100 linhas ·
**documento único** (nenhum outro foi criado para documentação).

### Cobertura

Identidade do projeto e os três nomes · resumo do produto · quadro de estado por
domínio · arquitetura com diagrama Mermaid · fluxo de requisição · multitenancy
com o **padrão copiável de tabela nova** · autenticação (reescrita nesta rodada)
· RBAC · banco com mapa de tabelas por domínio · migrations e o guard de destino
· Supabase (as quatro coisas que se confundem) · fluxo de chamado/OS · offline
com Mermaid e os **6 invariantes** · storage · documentos · engenharia clínica ·
**a fronteira metrológica e as 5 decisões bloqueadas** · eventos e workers · API
com o caminho para criar endpoint · frontends · portal e PORTAL-011 · field ·
segurança com a tabela **NUNCA FAÇA** · testes · CI · ambientes · deploy ·
homologação · migração Arkmeds · integrações futuras · ADRs · **known issues** ·
regras para uma nova IA · **mapa de código "quero mexer em X → leia Y"** ·
source of truth · como manter o documento · comandos.

### Verificação

Todos os caminhos de arquivo citados foram conferidos contra o disco: as duas
únicas não-correspondências são marcadores de exemplo
(`api-<dominio>.test.ts`, `NNNN_nome.sql`), intencionais.

### O que nele depende de validação

- **Ciclo de plano preventivo** — qual evento fecha o ciclo? Decisão do cliente.
- **Payload dos 6 tipos de documento** — depende de norma técnica.
- **As 5 decisões metrológicas** — dependem de metrologista e casos de
  referência.
- **Retenção de `client_operations`** — decisão de operação.
- **Fórmula de risco e de disponibilidade** — não confirmadas.

---

## 2 · AuthProvider: antes e depois

| | Antes | Depois |
| --- | --- | --- |
| Adaptadores | `LocalAuthProvider` (entra **sem senha**) | `local`, **`password`** (real), `supabase` (lança) |
| Escolha do provedor | **nenhuma** — `app.module` caía no local, sempre | `escolher-provedor.ts`, a partir de `AURORA_AUTH_PROVIDER` |
| `AURORA_AUTH_PROVIDER=supabase` | boot passava **aceitando entrada sem senha** | boot **falha alto**, explicando |
| Sessão | não existia | token opaco, `sha256` no banco, revogável |
| Sair | limpava o `localStorage`; **token seguia válido** | `POST /auth/logout` revoga **no servidor** |
| Login em homologação | **impossível** (a config recusa o provedor local) | funciona |

### O que foi construído

**Migration `0045_credenciais_e_sessoes.sql`** — `user_credentials` e
`user_sessions`, com uma decisão que organiza tudo: **`aurora_app` não recebe
privilégio nenhum sobre as duas tabelas**. RLS ligada e **forçada sem nenhuma
policy** — sem policy, ninguém submetido a ela lê uma linha, e não há política
frouxa para alguém ampliar sem perceber. Todo acesso passa por **seis funções
`SECURITY DEFINER` de consulta fixa**, de um papel novo, `aurora_auth`.

**Por que um papel novo:** a primeira versão pendurou as funções em
`aurora_identity`, e a suíte de isolamento acusou — há um teste que exige que
aquele papel tenha **apenas `SELECT`**. O teste estava certo: se alguma função
`SECURITY DEFINER` dele for explorada, um papel só-leitura limita o estrago a
leitura. A migration foi corrigida.

**`packages/domain/src/senha.ts`** — `scrypt` da biblioteca padrão do Node (zero
dependência nova, `npm audit` segue em 0), parâmetros embutidos no resumo para
poder endurecer o custo depois, regras de força que priorizam **comprimento
sobre complexidade**, e token de sessão com prefixo `aus_` reconhecível numa
varredura de segredos.

**`packages/db/src/credenciais.ts`** — login, sessão, logout, definição de senha.

**`apps/api/src/auth/`** — porta, adaptador `PasswordAuthProvider`, seleção por
configuração, e o controller com três rotas públicas:
`GET /v1/auth/config` · `POST /v1/auth/login` · `POST /v1/auth/logout`.

**`apps/web/src/routes/entrar.tsx`** — a tela **pergunta ao servidor como se
entra** (`/auth/config`) e desenha o formulário conforme a resposta. Com
provedor `password` pede senha e **não** mostra aviso de desenvolvimento; com
`local`, mostra. Uma tela que parece de produção sem ser ensina a confiar nela.

**`/login`** existe como apelido que redireciona para `/entrar`.

**`packages/app-kit/src/encerrar-sessao.ts`** — sair revoga no servidor e limpa o
local; se a chamada falhar, a limpeza local acontece assim mesmo.

**`tools/admin/criar.mjs`** — `npm run admin:criar`.

### Propriedades de segurança que o desenho garante

- **A recusa é idêntica** para e-mail inexistente, conta sem senha e senha
  errada — **inclusive no tempo**: a conta inexistente paga um `scrypt` de
  engodo. Sem isso, a diferença de latência enumera o cadastro inteiro sem
  acertar uma senha.
- **O banco guarda `sha256(token)`**, nunca o token.
- **Bloqueio progressivo com prazo** (5 erros → 1 min; 10 → 15 min). Permanente
  viraria negação de serviço contra a pessoa certa.
- **Token opaco e não JWT**: revogação vale no instante seguinte.
- **`aurora.definir_senha` não é concedida a `aurora_app`.**
- **Trocar a senha derruba as sessões abertas.**

---

## 3 · Três defeitos reais encontrados

1. **`AURORA_AUTH_PROVIDER` não era lida por ninguém.** A configuração dizia uma
   coisa e o processo fazia outra, sem nada acusar — e o que ele fazia era
   aceitar entrada sem senha. Corrigido com escolha explícita num lugar só, e
   `default` que **lança** em vez de cair no provedor local.

2. **O limitador de login punia o uso normal.** Ele contava **toda** tentativa,
   inclusive a bem-sucedida. Na suíte isso apareceu como teste vermelho; em
   produção seria um hospital atrás de um único endereço de saída — dez pessoas
   entram de manhã e a décima primeira recebe "muitas tentativas" sem ter errado
   nada, enquanto o ataque passa na mesma proporção. Agora **só a falha consome
   cota**.

3. **O limitador devolvia 422 onde o contrato declarava 429.** Para quem
   integra, a diferença decide o comportamento: 422 é "corrija o que mandou" e
   429 é "o que mandou está certo, espere". Um cliente que trata 422 como erro
   de entrada nunca tentaria de novo. Criado `RateLimitedError`, aplicado
   também na rota do QR, que tinha o mesmo defeito.

E um quarto, no próprio comando administrativo: ele confundia **titularidade**
com **papel** e tentava marcar `is_owner = true`, batendo no índice
`memberships_single_owner_uq`. O índice estava certo — tomar a titularidade de
quem já a tem mudaria, em silêncio, quem responde pela organização.

---

## 4 · Ambiente local

| | |
| --- | --- |
| **Banco** | PostgreSQL 16.14 em contêiner **`aurora-postgres`**, porta **15432**, banco `aurora` |
| **Outros projetos na máquina** | `ecommerce-template`, `pragminas-digital-hub`, `hpproto` — **nenhum foi tocado** |
| **Migrations** | 46 aplicadas, a última `0045_credenciais_e_sessoes.sql` |
| **Papel da API** | **`aurora_local_api`** — criado para esta instância, `NOBYPASSRLS`, `NOSUPERUSER`, herda de `aurora_app` |

O papel do E2E (`aurora_e2e_api`) **não foi reutilizado**: papel é objeto do
cluster, e trocar a senha dele quebraria a suíte com um erro que aponta para o
lugar errado. O aviso está no cabeçalho de `tools/e2e/provision-role.mjs` desde
30/08.

O schema foi **recriado do zero** no meio do trabalho, de propósito: um
`REASSIGN OWNED` que usei para reverter a migration levou junto funções que não
eram dela. Reconstruir garante que o banco bate exatamente com as migrations —
e limpou, de quebra, ~130 organizações-lixo deixadas por suítes antigas.

---

## 5 · Organização, conta e papel

| | |
| --- | --- |
| **Organização** | `[HOMOLOGAÇÃO] Prestadora Horizonte` (`homolog-prestadora`) |
| **Usuário** | `admin.demo@becare.local` |
| **Papel** | **`admin`** — papel de fábrica existente: "Tudo, exceto faturamento e titularidade" |
| **Permissões efetivas** | **109** |
| **Titularidade** | **não** — `is_owner` continua com Ana Administradora, do seed |
| **Provedor** | `password` |
| **Escopo** | `membership_scopes` criado junto com o vínculo |

**Nenhum papel novo foi inventado.** `admin` já existia e é exatamente o
"administrador que não responde pela fatura".

> ⚠️ **Conta temporária.** Senha fraca aceita **deliberadamente**
> (`--aceitar-senha-fraca`, que grita na saída do comando, com o motivo). Serve
> para desenvolvimento, homologação e demonstração — **não para produção**.
> A senha **não está no Git**, nem em migration, nem em seed, nem neste
> relatório. Antes de qualquer implantação real: remova a conta ou redefina a
> senha com `npm run admin:criar`.

### Massa de demonstração

2 organizações · 8 personas · 3 clientes · 8 locais · 7 ativos · 3 chamados ·
7 OS em vários estados · 2 contratos · 1 plano preventivo · 5 saldos (2 abaixo
do mínimo) · 1 orçamento.

Tudo marcado: organizações com `[HOMOLOGAÇÃO]` no nome, e-mails em
`@homologacao.aurora.test` (domínio reservado que não recebe mensagem), pessoas
com nome de função. **Nenhum dado real.**

---

## 6 · URL

| | |
| --- | --- |
| **Sistema** | `http://localhost:5411` |
| **Login** | `http://localhost:5411/login` (redireciona para `/entrar`) |
| **API** | `http://localhost:3011/v1` |
| **Usuário** | `admin.demo@becare.local` |
| **Senha** | combinada por escrito — **não registrada aqui** |

**É local.** Não há URL pública: nada está publicado (§8).

### Como subir

```bash
# 1. banco
docker start aurora-postgres

# 2. API  (precisa de DATABASE_URL, AURORA_AUTH_PROVIDER=password,
#          AURORA_CORS_ORIGINS=http://localhost:5411)
node tools/e2e/api.mjs

# 3. interface
VITE_API_URL=http://localhost:3011/v1 \
  npx vite --config apps/web/vite.config.ts --port 5411
```

As variáveis ficam em `.env.local`, que **o Git ignora**.

---

## 7 · Testes

### Portão completo — verde

```
npm run verify
  spec:audit ✓ · typecheck ✓ · lint ✓ · marca ✓ · openapi ✓
  1707 testes passando | 32 pulados | 88 arquivos
```

```
npx playwright test
  147 passando | 1 pulado | 3 perfis (desktop, portal, campo)
```

```
node tools/ci/check-secrets.mjs
  ✓ nenhum segredo detectado em 545 arquivos versionados
```

### Provas novas desta rodada — 59

| Arquivo | Provas | Cobre |
| --- | --- | --- |
| `packages/domain/src/__tests__/senha.test.ts` | 17 | força, resumo, sal por senha, resumo corrompido, bomba de custo, normalização Unicode, token |
| `packages/db/src/__tests__/credenciais.test.ts` | 25 | ciclo de sessão, bloqueio **com prazo**, indistinguibilidade, token nunca em claro no banco, teto absoluto, troca de senha derrubando sessões, privilégios, restrições |
| `apps/api/src/__tests__/api-auth.test.ts` | 17 | as três rotas, 401/403/422/429, mensagem idêntica, logout invalidando o token **na hora**, uma sessão não derruba a outra |

### Segurança, verificada

| Cenário | Esperado | Obtido |
| --- | --- | --- |
| Sem token | 401 | ✅ |
| Token inválido/inventado | 401 | ✅ |
| Senha errada | 401 | ✅ |
| E-mail inexistente | 401, **mensagem idêntica** | ✅ |
| Organização sem vínculo | 403 | ✅ |
| Admin correto | 200, 109 permissões | ✅ |
| Rajada de login | **429** com `retry_after_seconds` | ✅ |
| Token depois do logout | 401 | ✅ |
| `aurora_app` lendo `user_credentials` | sem privilégio | ✅ |
| `aurora_identity` | **só `SELECT`** | ✅ |

---

## 8 · Verificação no navegador

Feita de verdade, com o navegador, na porta final.

| # | Passo | Resultado |
| --- | --- | --- |
| 1 | abrir `/login` | redireciona para `/entrar`; pede **e-mail e senha**, sem aviso de desenvolvimento |
| 2 | credencial **errada** | "E-mail ou senha não conferem." na tela, com `role="alert"` |
| 3 | credencial correta | entra; "Bom dia, Administrador" |
| 4 | tela inicial | 3 chamados aguardando triagem |
| 5 | Solicitações | 3 chamados, contadores por situação |
| 6 | Ordens de serviço | Kanban: 4 abertas, 1 em execução, 1 fechada |
| 7 | Agenda | 4 não agendadas, baldes corretos |
| 8 | Ativos | 6 equipamentos com local e situação |
| 9 | Preventivas | 1 plano, próximo ciclo 31/03/2026 |
| 10 | Estoque | 5 saldos, 2 abaixo do mínimo |
| 11 | Contratos | 2 contratos |
| 12 | Orçamentos | 1 orçamento |
| 13 | Documentos | acervo vazio (a massa não cria documento) |
| 14 | Indicadores | volume e backlog com números; métricas de tempo sem formato |
| 15 | Configurações | Pessoas: a conta aparece como "Administrador" |
| 16 | **recarregar a página** | sessão continua |
| 17 | **sair** pelo menu | volta para `/entrar`, `localStorage` limpo |
| 18 | **token antigo contra a API** | **401** — revogado no servidor, não só escondido |
| 19 | rota protegida sem sessão | redireciona para `/entrar` |

**Nenhuma tela quebrou.** Duas observações, que não são defeitos de login:

- **Indicadores** mostram "formato ainda não apresentado nesta tela" para MTTR,
  primeira resposta e SLA — falta o formatador de duração na UI.
- **Documentos** está vazio porque a massa de homologação não cria documento; o
  módulo funciona (a rota responde 200 com lista vazia).

---

## 9 · Deploy

**Continua NOT DEPLOYED.** Nada foi publicado nesta rodada e nada é pago.

| Item | Estado |
| --- | --- |
| API · Web · Portal · Field · Workers | **NOT DEPLOYED** |
| PostgreSQL | local, contêiner `aurora-postgres` |
| Supabase | 🔒 bloqueado (ADR-025, OQ-16) |
| Storage | disco local |
| Domínio / DNS / TLS | não existem |
| Lojas | **READY**, não publicado |

**O que trava:** uma máquina, e a decisão de onde. Opções com custo em
`docs/AURORA-AMBIENTES.md`; a que não gasta é a máquina do próprio cliente.

---

## 10 · Pendências

| Pendência | Estado | Depende de |
| --- | --- | --- |
| **E2E do login por senha** | A suíte de navegador roda com provedor `local`. O login por senha tem 17 provas de HTTP e foi verificado à mão no navegador, mas **não tem prova automatizada de ponta a ponta** | um 4º par api+web no `playwright.config.mts` |
| **Recuperação de senha por e-mail** | não existe | transporte de e-mail |
| **MFA** | não existe | escolha de provedor/canal |
| **Login do portal e do field** | continuam no provedor de desenvolvimento | priorizado depois do web, conforme combinado |
| **Conta demo temporária** | ativa no banco local | remover antes de implantação real |
| **PDF de documento** | `pdf_key` existe, renderizador não | escolha de renderizador |
| **Ciclo de plano nunca fecha** | contornado, com teste | decisão do cliente |
| **Supabase** | bloqueado | *project ref* ou acesso |
| **Deploy** | nada publicado | uma máquina |

---

## 11 · Estado do Git

| | |
| --- | --- |
| **Branch** | `main` |
| **Commit anterior desta frente** | `15544c6` (local, revisado nesta rodada) |
| **Migration final** | `0045_credenciais_e_sessoes.sql` |
| **Segredos versionados** | **zero**, em 545 arquivos |
| **Senha demo no Git** | **não aparece** — verificado com `git ls-files \| xargs grep` |

---

## 12 · Próximos passos sugeridos

1. **Você entrar e avaliar** — é o objetivo desta rodada.
2. **Decidir onde hospedar** a homologação; é o único bloqueio para uma URL real.
3. **Fechar o E2E do login por senha** (pendência nomeada acima).
4. **Retomar o plano da auditoria de gap** —
   `docs/AUDITORIA-GAP-BECARE-TECHNECARE-V2-2026-09.md`, que aguarda sua
   aprovação desde 17/09: P0 (medição imutável, dado bruto, `external_id`, modo
   de uso) antes de qualquer feature nova.
