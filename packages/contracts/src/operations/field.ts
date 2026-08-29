/**
 * Aurora — a tela "Precisa da sua atenção" (SPEC v0.2 §20 · EPIC-014).
 *
 * O QUE ESTE CONTRATO PRECISA GARANTIR É UMA COISA SÓ: que o trabalho recusado
 * chegue INTEIRO ao aparelho de volta.
 *
 * Por isso `request_body` é `unknown` e não um esquema fechado. O corpo guardado
 * é o de qualquer rota de campo — uma transição, um apontamento, uma
 * assinatura —, e cada uma tem a sua forma. Um esquema fechado aqui obrigaria a
 * enumerar todas, e a primeira rota de campo nova quebraria a tela de conflito
 * de quem já está com trabalho pendurado nela: exatamente a hora em que ela
 * mais precisa funcionar.
 *
 * `route` é o que dá sentido ao corpo. A tela usa os dois juntos — "você tentou
 * concluir a OS, e escreveu isto" —, e é essa frase que permite a alguém
 * decidir o que fazer.
 */
import { defineOperation } from '../registry';
import { z, Uuid, Timestamp } from '../primitives';

export const FieldConflict = z.object({
  /** O identificador gerado no aparelho, antes da primeira tentativa. */
  client_operation_id: Uuid,
  /** 'POST /work-orders/:id/transitions' — o que ele tentou fazer. */
  route: z.string(),
  /** O código do domínio: `invalid_transition`, `conflict`, `precondition_failed`. */
  conflict_code: z.string().nullable(),
  /**
   * A explicação, na linguagem do domínio.
   *
   * "A OS foi cancelada às 14h12 por Ana Coordenadora" — e não "erro 409". A
   * pessoa em campo precisa saber o que aconteceu para decidir o que fazer, e
   * um código HTTP não conta nada a ninguém.
   */
  conflict_message: z.string().nullable(),
  /** O trabalho, do jeito que ele digitou. Ver a nota do cabeçalho. */
  request_body: z.unknown(),
  received_at: Timestamp,
});
export type FieldConflict = z.infer<typeof FieldConflict>;

export const fieldAttention = defineOperation({
  operationId: 'field.attention',
  method: 'GET',
  path: '/field/attention',
  summary: 'O que o servidor recusou e ainda ninguém tratou',
  public: false,
  permissions: ['work_order.read'],
  response: z.object({ items: z.array(FieldConflict) }),
});

export const fieldResolveConflict = defineOperation({
  operationId: 'field.resolveConflict',
  method: 'POST',
  path: '/field/attention/:id/resolve',
  summary: 'Registra que alguém tratou o conflito',
  public: false,
  permissions: ['work_order.execute'],
  /**
   * `superseded_by` é opcional porque nem toda decisão vira operação nova.
   *
   * "A OS foi cancelada mesmo, e o que eu escrevi não vale mais" é uma
   * resolução legítima — e exigir uma operação substituta obrigaria a inventar
   * uma para fechar a tela.
   */
  body: z.object({ superseded_by: Uuid.optional() }),
  response: z.object({ resolved: z.literal(true) }),
});
