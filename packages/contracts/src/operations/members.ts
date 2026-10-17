/**
 * Aurora — membros da organização (SPEC v0.2 §05 · EPIC-002).
 */
import { defineOperation } from '../registry';
import { z, Uuid, NonEmpty, Email, Ok } from '../primitives';

/**
 * Os assentos do banco (`aurora.seat_type`): equipe e portal.
 *
 * Estava `customer` no lugar de `portal` — a lista de membros devolvia
 * `portal` e o contrato recusava, e um convite com `customer` passava pela
 * validação e morria no banco com 500.
 */
export const SEAT_TYPES = ['staff', 'portal'] as const;
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
  status: z.enum(['invited', 'active', 'suspended', 'blocked', 'removed']),
  seat_type: z.enum(SEAT_TYPES),
  is_owner: z.boolean(),
  roles: z.array(z.string()),
  customer_scope: z.enum(SCOPE_MODES).nullable(),
  location_scope: z.enum(SCOPE_MODES).nullable(),
  /** Profissão — texto de cadastro; NÃO concede permissão. */
  // Opcionais: respostas capturadas antes da 0061 (demo) não os têm.
  job_title: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  /** Só a presença: o CPF em si sai apenas na ficha da pessoa. */
  has_cpf: z.boolean().optional(),
});
export type Member = z.infer<typeof Member>;

/** Os três perfis de acesso de negócio (reunião 16/10/2026). */
export const PROFILE_KEYS = ['operator', 'requester', 'manager'] as const;
export const ACCESS_STATES = ['active', 'suspended', 'blocked'] as const;
export const REGISTRATION_KIND_KEYS = ['CRM', 'COREN', 'CREA', 'CFT', 'CREFITO', 'OAB', 'OUTRO'] as const;

export const ProfessionalRegistration = z.object({
  kind: z.enum(REGISTRATION_KIND_KEYS),
  number: z.string().trim().min(2).max(24),
  region: z.string().trim().length(2).nullable().optional(),
});

/** Dados de cadastro do vínculo — iguais no "Adicionar usuário" e na edição. */
const camposDeCadastro = {
  cpf: z.string().trim().max(14).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  company_name: z.string().trim().max(160).nullable().optional(),
  job_title: z.string().trim().max(80).nullable().optional(),
  registrations: z.array(ProfessionalRegistration).max(10).optional(),
};

export const MemberDetail = Member.extend({
  cpf: z.string().nullable(),
  phone: z.string().nullable(),
  status_reason: z.string().nullable(),
  status_changed_at: z.string().nullable(),
  customer_ids: z.array(Uuid),
  location_ids: z.array(Uuid),
  registrations: z.array(z.object({ kind: z.string(), number: z.string(), region: z.string().nullable() })),
});
export type MemberDetail = z.infer<typeof MemberDetail>;

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
    /**
     * Perfil de acesso (Operador, Solicitante, Gestor). Quando vem, decide papel
     * e assento — prevalece sobre `seat_type`/`role_keys`.
     */
    profile: z.enum(PROFILE_KEYS).optional(),
    ...camposDeCadastro,
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
  summary: 'Adiciona uma pessoa à organização',
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

export const membersDetail = defineOperation({
  operationId: 'members.detail',
  method: 'GET',
  path: '/organizations/current/members/:id',
  summary: 'Ficha de uma pessoa: cadastro, registros profissionais, perfil, escopo e situação',
  description: 'O CPF completo só aparece aqui, para quem gerencia pessoas; a lista mostra apenas se existe.',
  permissions: ['organization.manage_members'],
  params: z.object({ id: Uuid }),
  response: MemberDetail,
  errors: ['not_found'],
});

export const membersUpdate = defineOperation({
  operationId: 'members.update',
  method: 'PATCH',
  path: '/organizations/current/members/:id',
  summary: 'Edita os dados de cadastro de uma pessoa',
  description:
    'CPF, telefone, empresa, profissão e registros profissionais (tipo + número, 0..N). Enviar ' +
    '`registrations` substitui a lista inteira. Profissão é texto de cadastro e não altera permissão.',
  permissions: ['organization.manage_members'],
  params: z.object({ id: Uuid }),
  body: z.object(camposDeCadastro).strict(),
  response: Ok,
  errors: ['not_found', 'conflict'],
});

export const membersSetStatus = defineOperation({
  operationId: 'members.setStatus',
  method: 'POST',
  path: '/organizations/current/members/:id/status',
  summary: 'Ativa, suspende ou bloqueia o acesso de uma pessoa',
  description:
    'Motivo obrigatório. Suspenso e bloqueado NÃO acessam: a resolução de vínculo só aceita vínculo ' +
    'ativo, então a próxima requisição com qualquer token é recusada no servidor. Nada é apagado. ' +
    'Ninguém muda a própria situação, e o último proprietário ativo não pode ser suspenso nem bloqueado.',
  permissions: ['organization.manage_members'],
  params: z.object({ id: Uuid }),
  body: z.object({ status: z.enum(ACCESS_STATES), reason: z.string().trim().min(5) }),
  response: Ok,
  status: 201,
  errors: ['not_found', 'conflict'],
});
