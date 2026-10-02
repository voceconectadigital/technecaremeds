-- =============================================================================
-- Aurora — 0050 vocabulário da metrologia N0
-- Auditoria de gap V2 P0.2, P2.1–P2.4 · PLAT §5, §6.1 (N0 manual estruturado)
--
-- SÓ VOCABULÁRIO, E EM ARQUIVO PRÓPRIO, DE PROPÓSITO.
--
-- O PostgreSQL aceita `ALTER TYPE … ADD VALUE` dentro de transação, mas não
-- deixa USAR o valor novo na mesma transação ("unsafe use of new value"). Como
-- cada migration roda numa transação, os valores nascem aqui e só são usados
-- (em CHECK, em índice parcial, em dado) a partir da 0051.
--
-- O que entra:
--   · `measurement` — o item de protocolo que registra leituras com unidade,
--     nominal e tolerâncias COMO DADO (0052). Sem veredito metrológico: o
--     critério de aceitação continua bloqueado (AURORA-METROLOGIA-FRONTEIRA).
--   · `raw_data` — o dado bruto da sessão de medição (PLAT §6.2 passo 5).
--   · `certificate` — o arquivo do certificado EXTERNO de um instrumento.
--   · `import_source` — o arquivo original de um lote de importação (0058).
-- =============================================================================

ALTER TYPE aurora.checklist_item_kind ADD VALUE IF NOT EXISTS 'measurement';

ALTER TYPE aurora.attachment_purpose ADD VALUE IF NOT EXISTS 'raw_data';
ALTER TYPE aurora.attachment_purpose ADD VALUE IF NOT EXISTS 'certificate';
ALTER TYPE aurora.attachment_purpose ADD VALUE IF NOT EXISTS 'import_source';

/**
 * De onde veio uma medição (PLAT §6.1, N0–N4; CART §3).
 *
 * Só `manual` tem adaptador hoje. Os demais existem no vocabulário para que a
 * medição integrada, quando vier, entre no MESMO modelo da manual — que é o
 * critério de aceite 4 do PLAT §14 — sem migration de núcleo.
 */
CREATE TYPE aurora.measurement_source AS ENUM ('manual', 'file', 'gateway', 'instrument', 'api', 'sdk');

/** Tipo de procedimento metrológico do protocolo (PLAT §5 "Procedimento"). */
CREATE TYPE aurora.procedure_kind AS ENUM ('calibration', 'electrical_safety', 'qualification', 'acceptance');

CREATE TYPE aurora.instrument_status AS ENUM ('active', 'in_calibration', 'out_of_service', 'retired');

/**
 * De quem é o instrumento.
 *
 * `third_party` é o instrumento de terceiro usado numa OS (auditoria de gap
 * §16, VAL-C): continua sendo um ativo cadastrado — porque precisa de série e
 * de certificado —, mas não é patrimônio da organização.
 */
CREATE TYPE aurora.instrument_ownership AS ENUM ('own', 'third_party');
