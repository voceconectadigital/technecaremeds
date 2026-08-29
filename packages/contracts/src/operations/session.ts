/**
 * Aurora — a sessão atual (SPEC v0.2 §21, §40).
 *
 * É a primeira chamada de toda tela: quem sou, onde estou, o que posso.
 */
import { defineOperation } from '../registry';
import { z, Uuid, NonEmpty } from '../primitives';

export const SessionUser = z.object({
  id: Uuid,
  name: z.string(),
  email: z.string(),
  /** Fuso da PESSOA, não do servidor: a agenda é lida no fuso de quem lê. */
  timezone: z.string(),
  locale: z.string(),
});

export const SessionOrganization = z.object({
  id: Uuid,
  slug: NonEmpty,
  name: NonEmpty,
  /**
   * Como esta organização chama o que mantém.
   *
   * "Equipamento" num hospital, "Ativo" numa indústria, "Frota" numa
   * transportadora. A interface usa esta palavra em vez de uma fixa — a
   * palavra do cliente é a que a pessoa reconhece na tela.
   */
  asset_label: NonEmpty,
});

export const Session = z.object({
  user: SessionUser,
  organization: SessionOrganization,
  membership: z.object({
    id: Uuid,
    seat_type: z.string(),
    roles: z.array(z.string()),
  }),
  /**
   * As permissões efetivas, com as revogações individuais já aplicadas.
   *
   * A interface usa isto para ESCONDER o que não leva a lugar nenhum — um item
   * de menu que dá 403 é pior do que um item ausente. Não é autorização:
   * esconder o botão é conveniência, e quem nega é o servidor em toda rota.
   */
  permissions: z.array(z.string()),
});
export type Session = z.infer<typeof Session>;

export const meSession = defineOperation({
  operationId: 'me.session',
  method: 'GET',
  path: '/me/session',
  summary: 'Quem sou, onde estou, o que posso',
  description:
    'Devolve o contexto JÁ RESOLVIDO — o mesmo que o guard de permissão usa. Não há segunda ' +
    'avaliação, e por isso não há como as duas discordarem.',
  response: Session,
  errors: ['unauthenticated', 'forbidden'],
});
