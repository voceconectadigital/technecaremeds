/**
 * Aurora — membros da organização (SPEC v0.2 §05 · EPIC-002).
 */
import { defineOperation } from '../registry';
import { z, Uuid, NonEmpty, Email, Ok } from '../primitives';

export const SEAT_TYPES = ['staff', 'customer'] as const;
export const SCOPE_MODES = ['all', 'listed'] as const;

/**
 * O alcance de um vínculo — o que a pessoa enxerga.
 *
 * Duas dimensões independentes: quais clientes e quais locais. Um vínculo que
 * enxerga o hospital inteiro mas só a UTI dele é um caso normal, não uma
 * combinação estranha, e por isso as duas não podem ser uma coisa só.
 *
 * `listed` com lista vazia é recusado: não enxerga nada, é estado válido no
 * banco e quase sempre engano de quem preenche o formulário.
 */
const camposDeEscopo = {
  customer_scope: z.enum(SCOPE_MODES).optional(),
  customer_ids: z.array(Uuid).optional(),
  location_scope: z.enum(SCOPE_MODES).optional(),
  location_ids: z.array(Uuid).optional(),
};

/**
 * As duas conferências, aplicáveis a qualquer esquema que carregue os campos.
 *
 * Função, e não um esquema pronto para espalhar com `...shape`: espalhar a
 * FORMA de um esquema refinado copia os campos e DEIXA AS REGRAS PARA TRÁS —
 * silenciosamente. Foi o que aconteceu na primeira versão deste arquivo, e o
 * convite passou a aceitar escopo restrito com lista vazia enquanto o ajuste de
 * escopo recusava. Quem pegou foi o teste.
 */
function comRegrasDeEscopo<T extends z.ZodObject<z.ZodRawShape>>(esquema: T) {
  return esquema
    .refine((v) => v.customer_scope !== 'listed' || ((v.customer_ids as unknown[])?.length ?? 0) > 0, {
      message: 'escopo de clientes "listed" exige ao menos um cliente',
      path: ['customer_ids'],
    })
    .refine((v) => v.location_scope !== 'listed' || ((v.location_ids as unknown[])?.length ?? 0) > 0, {
      message: 'escopo de locais "listed" exige ao menos um local',
      path: ['location_ids'],
    });
}

export const MembershipScopeInput = comRegrasDeEscopo(z.object(camposDeEscopo));

export const Member = z.object({
  membership_id: Uuid,
  user_id: Uuid,
  name: NonEmpty,
  email: z.string(),
  status: z.enum(['invited', 'active', 'suspended', 'removed']),
  seat_type: z.enum(SEAT_TYPES),
  is_owner: z.boolean(),
  roles: z.array(z.string()),
  customer_scope: z.enum(SCOPE_MODES).nullable(),
  location_scope: z.enum(SCOPE_MODES).nullable(),
});
export type Member = z.infer<typeof Member>;

export const membersList = defineOperation({
  operationId: 'members.list',
  method: 'GET',
  path: '/organizations/current/members',
  summary: 'Membros da organização corrente',
  description:
    'Inclui os suspensos, com a situação em `status`. Vínculo se suspende, não se apaga: a ' +
    'trilha de auditoria precisa continuar tendo dono.',
  permissions: ['organization.manage_members'],
  response: z.object({ items: z.array(Member) }),
});

export const InviteInput = comRegrasDeEscopo(
  z.object({
    email: Email,
    name: NonEmpty,
    seat_type: z.enum(SEAT_TYPES).optional(),
    role_keys: z.array(NonEmpty).optional(),
    daily_hours: z.number().positive().max(24).optional(),
    ...camposDeEscopo,
  })
);

export const membersInvite = defineOperation({
  operationId: 'members.invite',
  method: 'POST',
  path: '/organizations/current/members',
  summary: 'Convida uma pessoa para a organização',
  description:
    'Cria pessoa, vínculo, escopo e papéis numa transação só. O escopo é parte do convite e ' +
    'não um segundo passo: sem ele a pessoa entra numa tela vazia e não consegue distinguir ' +
    'isso de falta de permissão — e o banco recusa o vínculo cego de qualquer forma. ' +
    'Quando o e-mail já existe na plataforma, a MESMA pessoa ganha mais um vínculo: duas ' +
    'identidades para o mesmo endereço quebrariam o seletor de organização.',
  permissions: ['organization.manage_members'],
  body: InviteInput,
  response: z.object({
    membership_id: Uuid,
    user_id: Uuid,
    /** A pessoa já existia na plataforma e ganhou mais um vínculo. */
    reused_user: z.boolean(),
  }),
  status: 201,
  errors: ['conflict'],
});

export const membersSetScope = defineOperation({
  operationId: 'members.setScope',
  method: 'PATCH',
  path: '/organizations/current/members/:id/scope',
  summary: 'Ajusta o alcance de um vínculo',
  description:
    'Sempre alteração, nunca remoção seguida de criação: apagar deixaria a pessoa cega ' +
    'durante a transação, e um erro no meio a deixaria cega para sempre.',
  permissions: ['organization.manage_members'],
  params: z.object({ id: Uuid }),
  body: MembershipScopeInput,
  response: Ok,
  errors: ['not_found'],
});

export const membersSuspend = defineOperation({
  operationId: 'members.suspend',
  method: 'POST',
  path: '/organizations/current/members/:id/suspension',
  summary: 'Suspende um vínculo',
  description:
    'O motivo é obrigatório e vai para o evento: seis meses depois, "por que essa pessoa ' +
    'perdeu o acesso?" precisa ter resposta. O último proprietário ativo não pode ser ' +
    'suspenso — uma organização sem dono é uma organização que ninguém administra.',
  permissions: ['organization.manage_members'],
  params: z.object({ id: Uuid }),
  body: z.object({ reason: z.string().trim().min(5) }),
  response: Ok,
  status: 201,
  errors: ['not_found', 'conflict'],
});
