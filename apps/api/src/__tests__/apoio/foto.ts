/**
 * Aurora — a foto de equipamento das suítes HTTP (ATV-07 · 0085).
 *
 * O cadastro de equipamento (`POST /assets`) passou a exigir a foto no corpo. As suítes que
 * cadastram equipamento pela API mandam esta: um PNG de 1×1 pixel, de verdade — a API confere
 * os bytes (assinatura PNG), e não só o tipo declarado.
 */
export const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export const FOTO_PNG = { content_type: 'image/png' as const, data_base64: PNG_1X1_BASE64 };
