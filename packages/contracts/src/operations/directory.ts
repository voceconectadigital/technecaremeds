/**
 * Aurora — diretório: clientes e locais (SPEC v0.2 §05, §32 · EPIC-003).
 */
import { defineOperation } from '../registry';
import { z, Uuid, NonEmpty } from '../primitives';

export const Customer = z.object({
  id: Uuid,
  name: NonEmpty,
  trade_name: z.string().nullable(),
  code: z.string().nullable(),
  /** O cliente que É a própria organização — a clínica que atende a si mesma. */
  is_internal: z.boolean(),
  segment: z.string().nullable(),
  status: z.string(),
  location_count: z.number().int(),
});
export type Customer = z.infer<typeof Customer>;

export const customersList = defineOperation({
  operationId: 'customers.list',
  method: 'GET',
  path: '/customers',
  summary: 'Clientes que esta pessoa enxerga',
  description:
    'A lista já vem restrita pelo escopo do vínculo. `single_customer` diz à interface que ' +
    'não há o que escolher — a clínica que atende só a si mesma não deve ver um seletor de ' +
    'cliente com uma opção.',
  permissions: ['customer.read'],
  response: z.object({
    items: z.array(Customer),
    single_customer: z.boolean(),
  }),
  errors: ['forbidden'],
});
