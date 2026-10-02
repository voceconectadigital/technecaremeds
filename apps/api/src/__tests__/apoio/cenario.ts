/**
 * Aurora — cenário comum das suítes HTTP desta rodada (escopo atual, out/2026).
 *
 * As suítes antigas montam o próprio cenário, uma por uma, e isso continua
 * valendo. Este apoio existe porque as suítes novas precisam da MESMA coisa —
 * duas organizações, cada uma com cliente, local, categoria e uma pessoa com
 * papel de fábrica — e oitenta linhas copiadas cinco vezes divergem primeiro
 * no detalhe que importa: o papel, o escopo, a organização do contexto.
 *
 * Nada aqui atravessa a RLS sem dizer: o arranjo usa `withTenant` com contexto
 * de sistema, e só o que o harness já fazia (organização e pessoa) usa `raw`.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { newId, buildContext, PERMISSION_KEYS } from '@aurora/domain';
import { seedOrganization, seedMember, type TestDatabase } from '@aurora/db/testing/harness';
import {
  withTenant,
  provisionFactoryRoles,
  assignRole,
  provisionStarterLocationTypes,
  createCustomer,
  createLocation,
  createAssetCategory,
  provisionWorkOrderStates,
  createCatalogItem,
  type Database,
} from '@aurora/db';
import { loadEnv } from '@aurora/config';
import { createApp } from '../../bootstrap';

export const auth = (email: string) => ({ authorization: `Bearer local:${email}:${email}` });

export interface OrgDeTeste {
  org: string;
  user: string;
  mem: string;
  email: string;
  cliente: string;
  unidade: string;
  setor: string;
  categoria: string;
  natureza: string;
  /** Papéis de fábrica provisionados, por chave. */
  papeis: Map<string, string>;
}

export function ctxSistema(org: string) {
  return buildContext({
    organizationId: org,
    actorKind: 'system',
    requestId: `arranjo-${org.slice(0, 8)}`,
    permissions: PERMISSION_KEYS,
  });
}

/** Uma organização com o mínimo para abrir OS: cliente, unidade, setor, categoria, natureza. */
export async function criarOrganizacao(t: TestDatabase, slug: string, papel = 'admin'): Promise<OrgDeTeste> {
  const org = newId();
  const user = newId();
  const mem = newId();
  const email = `gestor@${slug}.test`;
  await seedOrganization(
    t,
    { organizationId: org, userId: user, membershipId: mem },
    { slug, name: `Organização ${slug}`, email, userName: `Gestor ${slug}` }
  );

  const r = await withTenant(t.db, ctxSistema(org), async (s) => {
    const papeis = await provisionFactoryRoles(s);
    await assignRole(s, mem, papeis.get(papel)!);
    await provisionWorkOrderStates(s);
    const tipos = await provisionStarterLocationTypes(s);
    const cliente = await createCustomer(s, { name: `Hospital ${slug}`, isInternal: false });
    const unidade = await createLocation(s, {
      customerId: cliente,
      locationTypeId: tipos.get('unidade')!,
      name: 'Sede',
    });
    const setor = await createLocation(s, {
      customerId: cliente,
      parentId: unidade,
      locationTypeId: tipos.get('setor')!,
      name: 'UTI',
    });
    const categoria = await createAssetCategory(s, { name: 'Ventilador Pulmonar' });
    const natureza = await createCatalogItem(s, {
      catalogKey: 'work_order_type',
      key: 'calibracao',
      label: 'Calibração',
      systemKey: 'calibration',
    });
    return { papeis, cliente, unidade, setor, categoria, natureza };
  });

  return { org, user, mem, email, ...r };
}

/** Mais uma pessoa na organização, com um papel de fábrica. */
export async function criarPessoa(
  t: TestDatabase,
  o: OrgDeTeste,
  slug: string,
  papel: string,
  opts: { seatType?: 'staff' | 'portal'; customerIds?: string[] } = {}
): Promise<{ user: string; mem: string; email: string }> {
  const user = newId();
  const mem = newId();
  const email = `${slug}@${o.email.split('@')[1]}`;
  await seedMember(
    t,
    { organizationId: o.org, userId: user, membershipId: mem },
    { email, userName: slug, seatType: opts.seatType, customerIds: opts.customerIds }
  );
  await withTenant(t.db, ctxSistema(o.org), (s) => assignRole(s, mem, o.papeis.get(papel)!));
  return { user, mem, email };
}

export async function subirApi(db: Database): Promise<{
  app: INestApplication;
  http: ReturnType<typeof request>;
}> {
  const env = loadEnv({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
    AURORA_LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);
  const app = await createApp({ db, env });
  await app.init();
  return { app, http: request(app.getHttpServer()) };
}
