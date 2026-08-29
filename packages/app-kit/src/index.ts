/**
 * Aurora — a base React compartilhada pelas duas aplicações.
 *
 * POR QUE ESTE PACOTE NASCEU
 *
 * O portal do cliente é uma aplicação PRÓPRIA — a SPEC §19 pede navegação,
 * vocabulário e densidade próprios, e a superfície de escrita mínima só é
 * auditável se o código do portal não puder alcançar o resto por acidente.
 *
 * Mas "aplicação própria" não significa "código duplicado". A ponte com a API,
 * a sessão guardada no navegador, o tema, e o estado que vive na URL são o
 * mesmo problema nas duas — e a versão copiada é a que diverge primeiro no
 * caso raro, que é onde ninguém olha.
 *
 * O QUE FICA AQUI E O QUE NÃO FICA
 *
 * Aqui: infraestrutura sem opinião de produto. O cliente da API não sabe quais
 * rotas existem (vem de `@aurora/contracts`); a sessão não sabe o que é um
 * papel; o tema não sabe que telas existem.
 *
 * Não fica aqui: nada que decida o que a aplicação MOSTRA. As telas, as rotas,
 * o menu e as consultas de domínio são de cada aplicação — e é justamente essa
 * separação que faz o portal continuar sendo auditável numa tarde.
 */
export { ApiProvider, useApi, useApiQuery, useApiMutation, queryKeyFor } from './api';
export type { ApiProviderProps, QueryOptions } from './api';
/*
 * `ApiError` é reexportado de `@aurora/contracts`, e não redefinido.
 *
 * A tela precisa dele para distinguir "o servidor recusou" de "a rede caiu", e
 * uma segunda classe com o mesmo nome quebraria o `instanceof` — em silêncio,
 * e só no caminho de erro, que é onde ninguém testa.
 */
export { ApiError } from '@aurora/contracts';

export { SessionProvider, useSession } from './session';
export type { SessionState } from './session';
export { PermissionsProvider, usePermissions, Can } from './permissions';
export type { PermissionApi } from './permissions';
export { useSessionQuery } from './use-session-query';
export { lerSessaoGuardada, CHAVE_TOKEN, CHAVE_ORG } from './session-guard';

export { ThemeProvider, useTheme } from './theme';
export type { Theme } from './theme';
export { useUrlState } from './url-state';
