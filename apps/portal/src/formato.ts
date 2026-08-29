/**
 * Aurora — formatação do portal.
 *
 * SEPARADA DA APLICAÇÃO INTERNA de propósito.
 *
 * A equipe lê "há 3 h" e sabe que é hoje; quem abriu um chamado ontem à noite
 * quer saber se foi ontem. O portal escreve o dia por extenso a partir de um
 * dia de diferença, porque a pessoa que consulta o próprio chamado consulta uma
 * vez por dia — e não a cada dez minutos.
 */

/** "agora", "há 20 min", "ontem", "12/11/2026". */
export function quando(iso: string): string {
  const instante = new Date(iso).getTime();
  const minutos = Math.round((Date.now() - instante) / 60000);

  if (minutos < 0) {
    // No FUTURO: é uma visita programada, e o que interessa é a data.
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (minutos < 2) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;

  const dias = Math.round(horas / 24);
  if (dias === 1) return 'ontem';
  if (dias < 7) return `há ${dias} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

/**
 * Centavos em texto viram reais.
 *
 * A divisão é sobre o INTEIRO, e a conversão para número acontece só no fim:
 * somar reais em ponto flutuante é o que produz o total que fecha com três
 * centavos de diferença.
 */
export function reais(centavos: string): string {
  const n = Number(centavos);
  if (!Number.isFinite(n)) return centavos;
  return (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** `2026-11-12` → `12/11/2026`, sem passar por fuso. */
export function data(iso: string | null): string | null {
  if (!iso) return null;
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}
