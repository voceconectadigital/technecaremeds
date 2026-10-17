-- =============================================================================
-- Aurora — 0070 endurecimento de acesso (pente-fino de 17/10/2026)
--
-- O papel de fábrica `operator` (Operador) nasceu na 0061 copiando as
-- permissões do Técnico — e com elas veio `asset.create`. A própria descrição
-- do papel diz o contrário: o Operador "não cadastra clientes, equipamentos,
-- planos nem checklists". `FACTORY_ROLES` (packages/domain/src/permissions.ts)
-- deixou de concedê-la; esta migration tira a permissão das organizações que
-- já existem.
--
-- Só o papel de FÁBRICA (`is_system`): um papel próprio que alguém copiou do
-- Operador e decidiu, de propósito, manter com `asset.create` é decisão da
-- organização, não desta correção.
--
-- IDEMPOTENTE: rodar de novo não encontra linha para apagar.
-- =============================================================================

DELETE FROM aurora.role_permissions rp
 USING aurora.roles r
 WHERE r.id = rp.role_id
   AND r.key = 'operator'
   AND r.is_system
   AND rp.permission_key = 'asset.create';
