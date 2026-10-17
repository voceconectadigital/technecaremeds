/**
 * Aurora — família (categoria) do equipamento × tipo (reunião 16/10/2026, Fase 3).
 *
 * O cliente definiu CINCO famílias. Elas são a raiz da taxonomia de
 * `asset_categories` (marcadas por `family_key`); o TIPO do equipamento
 * ("Ventilador pulmonar", "Monitor multiparamétrico") é a categoria-filha. O
 * nome do equipamento continua livre, mas nasce de um tipo do catálogo — e não
 * de texto solto que ninguém consegue contar depois.
 */
export const ASSET_FAMILIES = [
  { key: 'life_support', name: 'Suporte à vida' },
  { key: 'diagnosis', name: 'Diagnóstico' },
  { key: 'therapy', name: 'Terapia' },
  { key: 'treatment', name: 'Tratamento' },
  { key: 'support', name: 'Equipamentos de apoio' },
] as const;

export type AssetFamilyKey = (typeof ASSET_FAMILIES)[number]['key'];

export function isAssetFamilyKey(k: string): k is AssetFamilyKey {
  return ASSET_FAMILIES.some((f) => f.key === k);
}

/**
 * Identificação física de localização (chip geolocalizador, etiqueta RFID…).
 * Nesta fase é CADASTRO e VÍNCULO: nenhuma leitura de hardware existe.
 */
export const TRACKER_KINDS = [
  { key: 'gps', label: 'Chip geolocalizador (GPS)' },
  { key: 'ble', label: 'Beacon Bluetooth (BLE)' },
  { key: 'rfid', label: 'Etiqueta RFID' },
  { key: 'nfc', label: 'Etiqueta NFC' },
  { key: 'outro', label: 'Outro' },
] as const;

export type TrackerKind = (typeof TRACKER_KINDS)[number]['key'];

export function isTrackerKind(k: string): k is TrackerKind {
  return TRACKER_KINDS.some((t) => t.key === k);
}

/**
 * Aceita o token puro ou a URL pública da etiqueta (`…/q/<token>`): quem lê
 * uma etiqueta pré-impressa com a câmera recebe a URL inteira.
 */
export function qrTokenFromScan(raw: string): string {
  const t = raw.trim();
  const m = /\/q\/([^/?#\s]+)\/?(?:[?#].*)?$/.exec(t);
  return m ? m[1]! : t;
}
