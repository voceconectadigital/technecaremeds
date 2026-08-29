/**
 * Aurora — junção de classes.
 *
 * `clsx` resolve os condicionais; `twMerge` resolve o conflito entre duas
 * utilitárias que mexem na mesma propriedade. Sem o segundo, passar
 * `className="px-6"` para um componente que já tem `px-3` deixaria as duas no
 * elemento e o resultado dependeria da ordem em que o CSS foi gerado — o tipo
 * de bug que só aparece na build de produção.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
