# Homologação das telas em produção — 23/11/2026

Ambiente: `technecaremeds.voceconecta.com.br` (sessão real, só leitura, nada gravado).
Navegador: painel interno do app, oculto (página em segundo plano, por isso as telas demoram mais a montar).

## Resultado por tela

| Tela | Rota | Resultado | Observação |
|---|---|---|---|
| Ordens de serviço | `/ordens` | OK | Lista carrega com 12 abertas visíveis (WO-2026-0032 … 0015), equipamento e setor preenchidos |
| Painel de Controle | `/painel` | OK | Disponibilidade 93,3% (14/15), SLA 33,3% (1 no prazo, 2 estourados), backlog 25 (mais antiga há 53 dias), 7 abertos/1 concluído em 30 dias; MTTR/MTBF sem dados suficientes (esperado) |
| Qualidade | `/qualidade` | OK | Abas Calibração, Segurança elétrica, Qualificação, Treinamento, Serviços concluídos; estado vazio "Nenhum certificado ainda" |
| Equipamentos | `/ativos` | OK | Filtros de local, situação, cliente, família, nome, criticidade, chip e ANVISA; lista com 15 ativos |
| Clientes | `/clientes` | OK | 4 clientes, 28 locais, 15 equipamentos; contagem por cliente bate (2+7+4+2) |
| Contratos | `/contratos` | OK (corrigido) | 3 contratos; o selo errado do item 1 foi corrigido e publicado no mesmo dia |
| Relatórios | — | Não há rota própria no menu | Indicadores ficam no Painel |

## Pontos para olhar

1. **CT-2026-00001 (Hospital Santa Clara) aparece com "Vencido" e "Vigente" ao mesmo tempo.** A vigência termina em 23/11/2026, ou seja, hoje.
   **Causa:** `LinhaDeContrato` (`apps/web/src/features/comercial/contratos.tsx`) fazia `new Date(c.ends_on)`, que lê `2026-11-23` como meia-noite UTC (21 h do dia 22 em Brasília). A partir de ~9 h do último dia o arredondamento dava −1 e acendia "Vencido". O servidor (`contractTermStatus`) conta o último dia como vigente, por isso o selo "Vigente" ao lado.
   **Correção:** dias contados por calendário local com `diasAteOFimDaVigencia` (em `rotulos-contrato.ts`), barra de vigência com início/fim do dia local, e "Vence hoje" no último dia. Teste novo `apps/web/src/__tests__/vigencia-contrato.test.ts` compara a regra da tela com a do servidor.
   **Situação:** mesclada em `main` pela PR #49 (`dbe053b`) e publicada no front de produção (`technecare-web`) em 23/11/2026. Conferido no site: o CT-2026-00001 mostra "Vence hoje" ao lado de "Vigente".
2. **Console: um 401 e dois 422 de recursos da API.** **Resolvido, não é defeito do sistema.** Os erros vieram de chamadas de medição feitas à mão na mesma aba durante a auditoria, não das telas. O console do navegador guarda mensagens de páginas anteriores, por isso apareceram junto da navegação.
   - Os dois 422 eram `GET /v1/insights/control-panel` sem `from` e `to`. A API respondeu com a validação esperada (`from`/`to`: "expected string, received undefined"). A tela do Painel sempre envia o período e recebe 200.
   - O 401 corresponde a uma chamada sem credencial ("Credencial ausente").
   - Reconferência após o deploy da PR #49: Hoje, Qualidade, Painel, Ordens de serviço, detalhe de OS, Equipamentos, Clientes, Contratos, Agenda, Planos, Estoque, Solicitações, Ferramentas, Usuários e Configurações carregaram sem nenhuma resposta da API diferente de 200 e sem erros no console.
3. **CSP em modo report-only registrava violações em toda tela.** **Resolvido; a CSP passou a bloquear.**
   - **Causa:** dois recursos que a borda do Cloudflare injeta nas páginas da zona `voceconecta.com.br`, fora do nosso HTML. O **Zaraz** injetava scripts inline que mudam a cada página e disparava um **Facebook Pixel** (gatilho Pageview) em toda tela do sistema. O **Web Analytics** injetava o beacon `static.cloudflareinsights.com`.
   - **Zaraz:** desligado só nos hosts do Téchne Care (`technecaremeds`, `portal-`, `campo-` e `api-technecaremeds.voceconecta.com.br`) pela Configuration Rule "Téchne Care sem Zaraz". O pixel continua nos outros sites da zona.
   - **Web Analytics:** mantido de propósito e liberado em `script-src` (PR #51). Sistema, portal e campo republicados de `main` `d7884e6`.
   - **Modo bloqueante:** antes de ligar, uma navegação pelo sistema publicado (Painel, Qualidade, Ferramentas, Solicitações, Ordens, Agenda, Planos, Clientes, Equipamentos, Usuários, Estoque, Store, Contratos, Configurações, ficha de OS e de equipamento) e pelas entradas do portal e do campo não registrou nenhuma violação. As telas logadas do portal e do campo, e a leitura de QR pela câmera, não foram exercitadas.
   - **Se algo quebrar:** voltar `REPORT_ONLY` para `true` em `tools/lib/cabecalhos-pages.mjs` e republicar.
