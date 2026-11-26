# Relatório da sessão de 23/11/2026 — homologação, correções e publicações

Sessão de trabalho de 23 a 24/11/2026 (UTC), depois da auditoria corretiva de segurança e performance (PR #48). Tudo foi feito em `voceconectadigital/technecaremeds` e na produção `*.voceconecta.com.br`.

## Resumo

- **Homologação das telas em produção:** todas abriram. Apareceram três pontos, e os três foram resolvidos no mesmo dia.
- **Contrato "Vencido" no último dia da vigência:** era um erro de fuso na lista de contratos. Corrigido e publicado.
- **Erros 422 no console:** não eram defeito. Vieram de chamadas de medição feitas à mão durante a auditoria.
- **CSP (política de conteúdo):** os avisos vinham do Zaraz e do Web Analytics, que o Cloudflare injeta nas páginas. O Zaraz disparava um **Facebook Pixel** em toda tela do sistema. Ele foi desligado só nos endereços do Téchne Care, o Web Analytics foi liberado, e a CSP passou a **bloquear** nos três apps.
- **Olho para mostrar a senha:** adicionado nos campos de senha do sistema e do app de campo, e publicado.
- **Sete PRs** abertas e mescladas em `main` (#49 a #55, incluindo este relatório). A #48, da auditoria, já tinha sido mesclada antes. O front foi publicado quatro vezes. A API não precisou ser republicada.

## 1. Homologação das telas em produção

Percorri em produção, só lendo e sem gravar nada: Hoje, Painel, Ordens de serviço, ficha de OS, Equipamentos, ficha de equipamento, Clientes, Contratos, Qualidade, Agenda, Planos, Estoque, Solicitações, Ferramentas, Usuários, Configurações e Store. Todas abriram com os dados certos.

O resultado detalhado está em `docs/auditoria/homologacao-telas-2026-11-23.md`.

## 2. Contrato aparecia "Vencido" e "Vigente" ao mesmo tempo

- **Sintoma:** o contrato de demonstração, com vigência até 23/11/2026, aparecia na lista com os dois selos no próprio último dia.
- **Causa:** `apps/web/src/features/comercial/contratos.tsx` lia a data final com `new Date('AAAA-MM-DD')`. O JavaScript entende isso como meia-noite UTC, que no Brasil é 21h do dia anterior. A partir de umas 9h do último dia, a conta dava −1 dia. O servidor conta o último dia como vigente, por isso o "Vigente" ao lado.
- **Correção (PR #49):**
  - os dias passaram a ser contados pelo calendário (`diasAteOFimDaVigencia` em `rotulos-contrato.ts`);
  - a barra de vigência usa o dia local;
  - no último dia aparece "Vence hoje";
  - um teste novo confere que a tela e o servidor aplicam a mesma regra.
- **Em produção:** publicado. O contrato mostrou "Vence hoje" ao lado de "Vigente".

## 3. Erros 401 e 422 no console

Não é defeito do sistema.

- **Os dois 422:** eram chamadas que fiz à mão a `GET /v1/insights/control-panel` sem informar o período. A API respondeu com a validação esperada.
- **O 401:** era uma chamada sem login.

Depois disso, percorri de novo 15 telas em produção, e nenhuma resposta da API foi diferente de 200. Registrado na PR #50.

## 4. CSP, Zaraz e Facebook Pixel

- **Causa dos avisos:** o Cloudflare injeta dois recursos nas páginas da zona `voceconecta.com.br`, fora do nosso HTML:
  - **Zaraz:** scripts que mudam a cada página. Ele tinha um **Facebook Pixel** ligado no gatilho Pageview, então cada tela aberta no Téchne Care enviava o endereço e o título da tela para a Meta. Esses títulos incluem nomes de equipamentos e de setores de hospital.
  - **Web Analytics:** um script de medição de desempenho (`static.cloudflareinsights.com`).
- **Zaraz:** foi criada no Cloudflare a regra **"Téchne Care sem Zaraz"**, que desliga o Zaraz só em `technecaremeds`, `portal-technecaremeds`, `campo-technecaremeds` e `api-technecaremeds.voceconecta.com.br`. O pixel continua nos outros sites da zona. Conferido: nenhum dos três apps carrega mais o Zaraz.
- **Web Analytics:** mantido de propósito, porque mede o desempenho real sem cookies. Foi liberado na CSP (PR #51).
- **CSP bloqueante:** antes de ligar, percorri as telas do sistema publicado registrando violações e não houve nenhuma. A PR #52 passou a CSP para o modo que bloqueia, com um teste que confirma isso. Depois da publicação, as mesmas telas carregaram sem nenhuma violação.
- **Como voltar atrás se algo quebrar:** pôr `REPORT_ONLY = true` em `tools/lib/cabecalhos-pages.mjs` e publicar de novo.

## 5. Olho para mostrar e esconder a senha (PR #54)

Pedido: todo campo de senha precisa ter o ícone de olho para mostrar a senha. A mudança foi feita numa sessão separada e conferida aqui.

- **Componente novo `PasswordInput`:** fica em `packages/ui/src/components/field.tsx`, ao lado do `Input`, com o mesmo estilo.
  - O botão de olho usa os ícones `Eye`/`EyeOff` e alterna o campo entre senha escondida e texto visível.
  - Para leitores de tela, o botão se chama "Mostrar senha" ou "Ocultar senha".
  - Clicar no olho não envia o formulário, e o cursor volta para o mesmo ponto do campo.
  - Nome, preenchimento automático, rótulo e mensagem de erro do campo continuam funcionando como antes.
  - Se o campo estiver desabilitado, o olho também fica.
  - O olho próprio do navegador Edge fica escondido, para não aparecerem dois.
- **Onde entrou:** na tela de entrada do sistema (`apps/web/src/routes/entrar.tsx`) e na do app de campo (`apps/field/src/telas/entrar.tsx`). Eram os únicos campos de senha do código. O portal entra sem senha, e hoje não existe tela de troca ou redefinição de senha, porque a senha é definida pela administração.
- **Testes:** 7 testes novos em `packages/ui/src/__tests__/password-input.test.tsx`. Os testes da biblioteca de componentes e das telas de entrada passam (156), assim como os cinco checks do CI.
- **CSP:** a mudança não usa script inline nem recurso externo, então continua dentro da política bloqueante.
- **Situação:** mesclada em `main` (`9aa7565`) e **publicada** no sistema e no app de campo a partir de `main` `ff02a3c`.
- **Conferido em produção:** nas telas de entrada do app de campo e do sistema, o olho aparece dentro do campo. Um clique mostra a senha, muda o ícone para "Ocultar senha" e mantém o cursor no campo; outro clique esconde de novo. O Painel, já logado, abre normalmente na versão nova, sem bloqueios da CSP.
- **Quem já usa o app de campo** recebe a versão nova quando abrir o app outra vez.

## 6. PRs do dia

| PR | Título | Commit de merge |
| --- | --- | --- |
| #49 | Contrato não aparece "Vencido" no último dia da vigência | `dbe053b` |
| #50 | Homologação: erros 422 explicados | `de47561` |
| #51 | CSP libera o Web Analytics; Zaraz desligado | `d7884e6` |
| #52 | CSP passa a bloquear | `021c8bb` |
| #53 | Homologação registra as publicações em produção | `57760d5` |
| #54 | Olho para mostrar e esconder a senha | `9aa7565` |
| #55 | Este relatório | `ff02a3c` |

Todas passaram por Estático, PostgreSQL 16, Ponta a ponta, Gate e Cloudflare Pages antes do merge. Nas PRs só de documentação, o próprio CI pula os testes de banco e de ponta a ponta.

## 7. Publicações em produção

O front é publicado por upload direto no Cloudflare Pages, sempre a partir de `main`. A API não foi republicada: ela já roda o mesmo código de `main` (impressão `7fea2ba90690`), e isso foi conferido antes de cada publicação.

| Quando (UTC) | Commit | Apps | O que mudou |
| --- | --- | --- | --- |
| 23/11 ~17h | `dbe053b` | sistema | selo "Vence hoje" do contrato |
| 23/11 ~21h | `d7884e6` | sistema, portal, campo | CSP libera o Web Analytics |
| 23/11 ~23h40 | `021c8bb` | sistema, portal, campo | CSP bloqueante |
| 24/11 ~00h40 | `ff02a3c` | sistema, campo | olho para mostrar e esconder a senha |

O portal não foi publicado na última rodada porque não tem campo de senha; ele continua em `021c8bb`.

## 8. O que ficou pendente

- **Portal e app de campo depois do login, e leitura de QR pela câmera:** não testados com a CSP bloqueante. Se aparecer "Refused to…" no console, é a CSP; o jeito de voltar atrás está na seção 4.
- **Migration `0091` da auditoria:** sem confirmação de que foi aplicada no banco de produção.
- **Auto-merge desligado no repositório:** com ele desligado, todo merge espera alguém chamar depois que os testes terminam. Ligar em Settings → General → Pull Requests → "Allow auto-merge" resolve.

## 9. Problemas encontrados no caminho

- **`npx wrangler` travou:** ele tentou baixar uma versão nova. As publicações foram feitas com a versão já instalada nesta máquina (4.166.0).
- **Painel do Cloudflare:** recarregou no meio do preenchimento e apagou o formulário da regra do Zaraz. Ele foi preenchido de novo e conferido antes de implantar.
- **Reinício do computador:** aconteceu no meio do trabalho da CSP. A branch estava salva e o trabalho continuou de onde parou.
