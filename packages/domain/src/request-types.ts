/**
 * Aurora — tipos de solicitação (reunião 16/10/2026, Fase 4).
 *
 * Lista FECHADA definida pelo cliente. Não existe tipo livre: "manutenção
 * livre" virava pedido de mudança de equipamento de lugar, que é outra
 * operação (transferência, com `asset.transfer` e motivo), fora do alcance do
 * solicitante.
 *
 * Cada tipo aponta para a NATUREZA de OS (`work_order_type`) com a mesma chave
 * de sistema: é ela que a triagem propõe ao aceitar, e é por ela que os
 * indicadores separam preventiva de corretiva.
 */
export const SERVICE_REQUEST_TYPES = [
  { key: 'corrective', label: 'Corretiva' },
  { key: 'preventive', label: 'Preventiva' },
  { key: 'technical_instruction', label: 'Instrução Técnica' },
  { key: 'training', label: 'Treinamento' },
  { key: 'calibration', label: 'Calibração' },
  { key: 'electrical_safety', label: 'Teste de Segurança Elétrica' },
  { key: 'qualification', label: 'Qualificação' },
] as const;

export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number]['key'];

export const SERVICE_REQUEST_TYPE_KEYS = SERVICE_REQUEST_TYPES.map(
  (t) => t.key
) as readonly ServiceRequestType[];

export function isServiceRequestType(k: unknown): k is ServiceRequestType {
  return typeof k === 'string' && SERVICE_REQUEST_TYPES.some((t) => t.key === k);
}

export function serviceRequestTypeLabel(k: string | null | undefined): string | null {
  if (!k) return null;
  return SERVICE_REQUEST_TYPES.find((t) => t.key === k)?.label ?? k;
}
