/**
 * Aurora — o DIA no calendário de quem está na tela (pente-fino 17/10/2026,
 * PF-72).
 *
 * `new Date().toISOString().slice(0, 10)` é o dia em UTC: em Brasília, das
 * 21 h à meia-noite, isso já é "amanhã" — o orçamento nascia vencendo um dia
 * depois, o filtro "até hoje" incluía o dia seguinte. Aqui o dia é o do
 * relógio do navegador (hora local), que é o que a pessoa vê no canto da tela.
 *
 * O servidor usa o fuso da ORGANIZAÇÃO (`organizations.timezone`) para as
 * próprias contas; a tela usa o do navegador para o que a pessoa digita e lê.
 */

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Dia (AAAA-MM-DD) do instante, no calendário LOCAL do navegador. */
export function diaLocal(d: Date = new Date()): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

/** Hoje (AAAA-MM-DD), no calendário local. */
export function hojeLocal(): string {
  return diaLocal(new Date());
}

/** Soma dias a um dia de calendário (AAAA-MM-DD) — aritmética de calendário, sem fuso. */
export function somarDias(dia: string, dias: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const x = new Date(Date.UTC(a!, m! - 1, d! + dias));
  return `${String(x.getUTCFullYear()).padStart(4, '0')}-${doisDigitos(x.getUTCMonth() + 1)}-${doisDigitos(x.getUTCDate())}`;
}

/** Hoje + N dias (AAAA-MM-DD), no calendário local. */
export function diaLocalDaqui(dias: number): string {
  return somarDias(hojeLocal(), dias);
}

/** O instante da meia-noite LOCAL do dia (AAAA-MM-DD). */
export function inicioDoDiaLocal(dia: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(a!, m! - 1, d!, 0, 0, 0, 0);
}

/** O último milissegundo LOCAL do dia (AAAA-MM-DD). */
export function fimDoDiaLocal(dia: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(a!, m! - 1, d!, 23, 59, 59, 999);
}
