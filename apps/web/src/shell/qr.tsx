/**
 * Aurora — QR code desenhado no navegador (conversa com o cliente, 21/10/2026: "em cada
 * ativo falta QR CODE").
 *
 * O produto guardava o token da etiqueta mas nunca desenhava o código. Aqui ele é
 * desenhado em SVG, sem rede e sem servidor: a matriz sai de `qrcode-generator` (MIT, sem
 * dependências) e vira UM `<path>`. Não usa `innerHTML` — o que entra no desenho é só a
 * matriz de módulos.
 */
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export function matrizDeQr(texto: string): boolean[][] {
  // Tipo 0 = o menor que couber; correção "M" tolera ~15 % de dano na etiqueta impressa.
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** O endereço que a etiqueta carrega: abre o equipamento no sistema (rota `/q/:token`). */
export function enderecoDaEtiqueta(token: string, origem = window.location.origin): string {
  return `${origem}/q/${token}`;
}

export function QrSvg({ texto, tamanho = 168, rotulo }: { texto: string; tamanho?: number; rotulo: string }) {
  const { caminho, lado } = useMemo(() => {
    const m = matrizDeQr(texto);
    const margem = 2; // "zona silenciosa" mínima do padrão
    let d = '';
    m.forEach((linha, r) =>
      linha.forEach((escuro, c) => {
        if (escuro) d += `M${c + margem} ${r + margem}h1v1h-1z`;
      })
    );
    return { caminho: d, lado: m.length + margem * 2 };
  }, [texto]);

  return (
    <svg
      role="img"
      aria-label={rotulo}
      width={tamanho}
      height={tamanho}
      viewBox={`0 0 ${lado} ${lado}`}
      shapeRendering="crispEdges"
    >
      <rect width={lado} height={lado} fill="#fff" />
      <path d={caminho} fill="#000" />
    </svg>
  );
}
