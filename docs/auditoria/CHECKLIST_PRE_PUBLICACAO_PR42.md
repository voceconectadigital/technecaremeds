# Checklist de pré-publicação — PR #42 (rodada Anderson 29–30/10/2026)

**Para uso interno.** Nada daqui foi executado em produção: cada passo com ⚠ exige a sua autorização expressa.
**Destino de produção** (conforme a última publicação, de 22/10/2026):
- **API, workers e PostgreSQL:** runtime "Téchne Care — produção" no HostPanel.
- **Front:** projetos Cloudflare Pages `technecare-web`, `technecare-portal` e `technecare-field`, publicados por upload direto.
- **Conferir a versão:** `GET /v1/health/version`.

## 0. Antes de tudo
- [x] CI da PR #42 verde no HEAD de código `62eb8c3` (run 41048276925): Estático, PostgreSQL 16 2.846/2.846, Ponta a ponta 237, Gate. Conferir também o run do commit de documentação.
- [ ] ⚠ Merge da PR #42 na `main`, só com a sua ordem.
- [ ] Comunicar a equipe de campo: **concluir OS de equipamento passa a exigir o parecer** "Liberado para uso" ou "Equipamento parado".

## 1. Consultas de leitura no banco de produção, ANTES do deploy
Rodar como leitura (papel `aurora_readonly` ou console do HostPanel). Nenhuma delas altera dado.

**1.1 Automações por evento que vão começar a disparar.** Até hoje o worker só registrava o evento, então regras ligadas ficavam caladas. Depois do deploy, elas rodam.
```sql
SELECT o.name AS organizacao, r.name, r.trigger_event, r.state, r.quarantined_at
  FROM aurora.automation_rules r JOIN aurora.organizations o ON o.id = r.organization_id
 WHERE r.trigger_kind = 'event' AND r.state = 'active' AND r.quarantined_at IS NULL
 ORDER BY o.name, r.name;
```
Para cada regra listada, decida se ela deve mesmo disparar. Se não, pause-a antes do deploy.

**1.2 Duplicidades que fariam a migration 0088 falhar.** A 0088 cria um índice único em `(rule_id, event_id)`.
```sql
SELECT rule_id, event_id, count(*) FROM aurora.rule_runs
 WHERE event_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
```
O esperado é **zero linhas**. Se vier alguma linha, **não publique**: a migration falharia e o deploy pararia. Traga o resultado para resolvermos antes, sem apagar log às cegas.

**1.3 Tags repetidas (migration 0089).**
```sql
SELECT organization_id, replace(aurora.normalize_label(tag), ' ', '') AS tag_normalizada, count(*)
  FROM aurora.assets WHERE deleted_at IS NULL AND tag IS NOT NULL
 GROUP BY 1, 2 HAVING count(*) > 1;
```
A 0089 não falha com repetidas: ela marca os mais novos de cada grupo como `tag_legacy_duplicate` e os deixa fora do índice único. O resultado diz quantos equipamentos alguém vai precisar corrigir depois.

**1.4 Organizações que perderiam o orçamento.** O modo hospital nasce sem orçamento.
```sql
SELECT name, usage_mode, enabled_features FROM aurora.organizations WHERE deleted_at IS NULL;
```
Organização com `usage_mode = 'hospital'` e `enabled_features` nulo **deixa de ver "Gerar orçamento"** depois do deploy. Se ela usa orçamento hoje, ligue o recurso `quotes` nela antes. Organização de prestadora não muda.

**1.5 Quem conclui OS sem parecer hoje** (automação ou integração).
```sql
SELECT r.name FROM aurora.automation_rules r JOIN aurora.automation_actions a ON a.rule_id = r.id
 WHERE r.state = 'active' AND a.kind = 'change_status';
```
Regra que conclui OS de equipamento vai receber 422 sem `operational_result`. Ajuste a regra, ou desligue a exigência na organização (`settings.require_operational_result = false`).

## 2. Backup e rollback
- [ ] ⚠ Backup novo do PostgreSQL no HostPanel **e** `restore_drill` verificado, como em 22/10.
- [ ] Anotar o commit e a `impressao` atuais de `/v1/health/version` (é o ponto de volta).
- **Rollback da API:** redeploy do `ref` anterior no HostPanel.
- **Rollback do banco:** as migrations 0084–0089 **não têm volta automática**; voltar o banco é restaurar o backup do passo anterior. Por isso o backup é obrigatório. A API antiga funciona com as colunas novas (todas opcionais ou com padrão), mas o índice único de tag e o gatilho que impede apagar tag continuam valendo.
- **Rollback do front:** rebuild do commit anterior + `wrangler pages deploy` nos três projetos (wrangler não tem rollback nativo).

## 3. Migrations — o que cada uma faz no banco existente

| Migration | Efeito | Risco |
|---|---|---|
| 0084 | Público da Store (`store_audience`, padrão `all`), tabela `store_item_customers`, status `separated` no pedido | Baixo: o padrão mantém o comportamento atual |
| 0085 | Nível de relatório e vigência no cliente; foto e `sla_enabled` (padrão ligado) no ativo; nova `resolve_sla_policy` | Baixo: `sla_enabled` ligado mantém os relógios como hoje |
| 0087 | Ativação/inativação e procedimentos extras no plano | Baixo: só colunas novas |
| 0088 | Índice único (regra, evento) em `rule_runs` | **Falha se houver duplicidade** (consulta 1.2) |
| 0089 | Tag única por organização + gatilho que impede apagar tag; ANVISA "não se aplica"; CNPJ da empresa; procedimento no certificado | Médio: tags repetidas marcadas (1.3); importações que apagam tag passam a receber erro |

A 0086 não existe, de propósito: o número ficou sem uso e o migrador aceita a lacuna. Testado no CI, que aplica todas em banco limpo.

## 4. Ordem de publicação (⚠ cada passo com a sua autorização)
1. Backup + `restore_drill` (passo 2).
2. Consultas 1.1 a 1.5 resolvidas.
3. **API + workers** (mesmo runtime no HostPanel): deploy do `ref` do merge. As migrations rodam no deploy, e os workers sobem com o despacho de automações.
4. Conferir `/v1/health/version` (`impressao` igual a `npm run versao` no commit) e `ready`.
5. **Web** (`technecare-web`), **portal** (`technecare-portal`) e **campo** (`technecare-field`): build com `VITE_API_URL` de produção e `wrangler pages deploy`. O front novo depende das rotas novas, por isso vem **depois** da API.
6. **Campo:**
   - O PWA troca de versão sozinho na próxima abertura com rede (service worker com `skipWaiting` + `clients.claim`).
   - Uma conclusão que já estava **na fila offline** da versão antiga volta com 422 ao sincronizar e cai em "Atenção". O técnico escolhe o parecer e reenvia.
   - Os apps nativos (Android e iOS) não estão publicados nas lojas, então não há versão de loja para atualizar.
7. Teste rápido em produção:
   - abrir uma OS e concluir com parecer;
   - Store → Gerenciar catálogo;
   - Painel → Gerar relatório (PDF e Excel);
   - Ferramentas;
   - clicar na marca.

## 5. O que NÃO bloqueia a publicação

| Tipo | Itens | Por quê |
|---|---|---|
| Depende de Anderson | Fórmulas P-01…P-16 (REL-04, REL-05, REL-06, OPS-10); campos com aprovação (USR-09, USR-11); indicadores do financeiro (AUT-05); retenção da geolocalização (OPS-07); confirmar "hospital sem orçamento" (OS-03) | O sistema mostra "pendente" ou "provisório" sem inventar número. Os recursos autorizados funcionam |
| Serviço externo | Provedor de e-mail (USR-02, ORC-03, AUT-02, AUT-03); domínio e VPS (OPS-05) | Os avisos chegam pela caixa de entrada do sistema. A senha do usuário novo sai por `admin:criar` |
| Futuro, comercial ou V2 | ATF-01…03, FUT-01…05; TEN-02, TEN-04; V2Q-01…13 | Fora desta fase por contrato |

## 6. Bloqueios reais de produção
- Duplicidade em `rule_runs` (1.2), se houver.
- Regra ativa que não deve disparar (1.1), se não for pausada antes.
- Organização em modo hospital que usa orçamento (1.4), se não tiver o recurso ligado antes.
- Faltar backup verificado (2).
