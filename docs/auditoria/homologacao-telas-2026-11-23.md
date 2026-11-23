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
| Contratos | `/contratos` | OK, com ressalva | 3 contratos; ver item 1 abaixo |
| Relatórios | — | Não há rota própria no menu | Indicadores ficam no Painel |

## Pontos para olhar

1. **CT-2026-00001 (Hospital Santa Clara) aparece com "Vencido" e "Vigente" ao mesmo tempo.** A vigência termina em 23/11/2026, ou seja, hoje.
   **Causa:** `LinhaDeContrato` (`apps/web/src/features/comercial/contratos.tsx`) fazia `new Date(c.ends_on)`, que lê `2026-11-23` como meia-noite UTC (21 h do dia 22 em Brasília). A partir de ~9 h do último dia o arredondamento dava −1 e acendia "Vencido". O servidor (`contractTermStatus`) conta o último dia como vigente, por isso o selo "Vigente" ao lado.
   **Correção (local, sem commit):** dias contados por calendário local com `diasAteOFimDaVigencia` (em `rotulos-contrato.ts`), barra de vigência com início/fim do dia local, e "Vence hoje" no último dia. Teste novo `apps/web/src/__tests__/vigencia-contrato.test.ts` compara a regra da tela com a do servidor.
2. **Console: um 401 e dois 422 de recursos da API** durante a navegação. O painel oculto não registrou a URL das chamadas e nenhuma tela mostrou erro ao usuário. Vale reproduzir com o painel visível (DevTools → Rede) para saber qual endpoint respondeu 422.
3. **CSP em modo report-only** registra violações para scripts inline e para o `beacon.min.js` do Cloudflare Insights/Zaraz. Não bloqueia nada. Antes de passar a CSP para modo bloqueante, liberar o hash/host ou desligar o beacon.
