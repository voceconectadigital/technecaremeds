/**
 * Qual ícone representa a profissão no cadastro (reunião de 16/10/2026: "o
 * bonequinho de perfil" que mostra se a pessoa é enfermeira, médico, engenheiro…).
 *
 * É APRESENTAÇÃO: devolve uma chave, nunca uma permissão — nenhuma profissão
 * concede acesso. A comparação ignora caixa e acento, porque a profissão é texto
 * livre ("Enfermeira", "ENFERMEIRO(A)").
 */
export type IconeDeProfissao =
  | 'doctor'
  | 'nurse'
  | 'engineer'
  | 'technician'
  | 'buyer'
  | 'manager'
  | 'executive'
  | 'person';

export function iconeDaProfissao(titulo: string | null | undefined): IconeDeProfissao {
  const t = (titulo ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!t.trim()) return 'person';
  // "técnico de enfermagem" e "auxiliar de enfermagem" são enfermagem, não técnico.
  if (/enfermag|enfermeir/.test(t)) return 'nurse';
  if (/medic|doutor/.test(t)) return 'doctor';
  if (/engenheir/.test(t)) return 'engineer';
  if (/tecnic/.test(t)) return 'technician';
  if (/comprador|suprimento/.test(t)) return 'buyer';
  if (/gerente|coordenador|supervisor/.test(t)) return 'manager';
  if (/diretor|empresari|socio|presidente/.test(t)) return 'executive';
  return 'person';
}
