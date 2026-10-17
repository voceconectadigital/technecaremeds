/**
 * Aurora — "Novo Negócio" (reunião 16/10/2026, Fase 11).
 *
 * Só para o admin GLOBAL de plataforma — concessão feita pelo DBA, sem rota.
 * Para os demais, a página diz isso e não mostra nada de outra organização.
 *
 * Um código, vários negócios: criar aqui é criar DADO (organização, base de
 * fábrica, marca e o primeiro administrador). Domínio próprio fica PEDIDO —
 * DNS e certificado não são automatizados (BLOQUEADO — INFRA). Sem preço.
 */
import { useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  SkeletonList,
  StatusChip,
  useToast,
} from '@aurora/ui';
import {
  platformMe,
  platformTenantsCreate,
  platformTenantsList,
  type TenantSummary,
} from '@aurora/contracts';
import { ApiError, useApiMutation, useApiQuery } from '@aurora/app-kit';
import { AppShell } from '../../shell/app-shell';
import { AlternadorDeConfiguracoes } from './alternador';

export function NegociosPage() {
  const { data: eu, isLoading: carregandoEu } = useApiQuery(platformMe) as {
    data: { platform_admin: boolean } | undefined;
    isLoading: boolean;
  };
  const admin = eu?.platform_admin === true;

  return (
    <AppShell
      title="Novo negócio"
      subtitle="Organizações (tenants) da plataforma — um código, dados separados."
      breadcrumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Novo negócio' }]}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AlternadorDeConfiguracoes />
        <span className="flex-1" />
        {admin && <BotaoNovoNegocio />}
      </div>
      {carregandoEu ? (
        <SkeletonList rows={3} label="negócios" />
      ) : admin ? (
        <ListaDeNegocios />
      ) : (
        <Card>
          <EmptyState
            icon={<Building2 className="size-5" />}
            title="Exclusivo do admin global de plataforma"
            description="Criar e listar negócios não é permissão de organização: é concedido explicitamente pela operação da plataforma."
          />
        </Card>
      )}
    </AppShell>
  );
}

function ListaDeNegocios() {
  const { data, isLoading } = useApiQuery(platformTenantsList) as {
    data: { items: TenantSummary[] } | undefined;
    isLoading: boolean;
  };
  if (isLoading) return <SkeletonList rows={4} label="negócios" />;
  return (
    <Card>
      <ul>
        {(data?.items ?? []).map((t, i) => (
          <li
            key={t.id}
            className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border-subtle' : ''}`}
          >
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded-full border border-border-subtle"
              style={{ background: t.branding.primary_color ?? 'transparent' }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base text-text">{t.branding.display_name ?? t.name}</span>
              <span className="block truncate text-xs text-muted">
                {t.slug} · {t.name}
              </span>
            </span>
            {t.domain && (
              <StatusChip
                size="sm"
                tone="warn"
                hint="Apontamento de DNS e certificado não automatizados (BLOQUEADO — INFRA)"
              >
                {t.domain.host} · aguardando DNS
              </StatusChip>
            )}
            <StatusChip size="sm" tone={t.status === 'active' ? 'good' : 'neutral'}>
              {t.status === 'active' ? 'Ativo' : t.status}
            </StatusChip>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BotaoNovoNegocio() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAberto(true)}>
        Novo negócio
      </Button>
      {aberto && <DialogoNovoNegocio onFechar={() => setAberto(false)} />}
    </>
  );
}

function DialogoNovoNegocio({ onFechar }: { onFechar: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: '',
    slug: '',
    tax_id: '',
    display_name: '',
    primary_color: '#0b6e4f',
    support_email: '',
    domain: '',
    admin_name: '',
    admin_email: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const criar = useApiMutation(platformTenantsCreate, {
    invalidates: [platformTenantsList],
    onError: (e: ApiError) => toast.error('Negócio não criado', e.problem.message),
  });

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onFechar()}
      title="Novo negócio"
      description="Cria a organização com a base de fábrica e o primeiro administrador."
      footer={
        <>
          <Button onClick={onFechar}>Cancelar</Button>
          <Button
            variant="primary"
            loading={criar.isPending}
            onClick={() =>
              criar.mutate(
                {
                  body: {
                    name: f.name.trim(),
                    slug: f.slug.trim(),
                    tax_id: f.tax_id.trim() || null,
                    branding: {
                      display_name: f.display_name.trim() || null,
                      primary_color: f.primary_color || null,
                      support_email: f.support_email.trim() || null,
                    },
                    domain: f.domain.trim() || null,
                    admin: { name: f.admin_name.trim(), email: f.admin_email.trim() },
                  },
                },
                {
                  onSuccess: () => {
                    toast.success('Negócio criado', 'O administrador já pode entrar.');
                    onFechar();
                  },
                }
              )
            }
          >
            Criar negócio
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Razão social / nome">
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Identificador (slug)" hint="minúsculas, números e hífen">
          <Input value={f.slug} onChange={set('slug')} />
        </Field>
        <Field label="CNPJ">
          <Input value={f.tax_id} onChange={set('tax_id')} />
        </Field>
        <Field label="Nome de exibição (marca)">
          <Input value={f.display_name} onChange={set('display_name')} />
        </Field>
        <Field label="Cor primária">
          <Input type="color" value={f.primary_color} onChange={set('primary_color')} />
        </Field>
        <Field label="E-mail de suporte">
          <Input type="email" value={f.support_email} onChange={set('support_email')} />
        </Field>
        <Field label="Domínio desejado" hint="Fica pendente: DNS e certificado não são automatizados">
          <Input value={f.domain} onChange={set('domain')} placeholder="cliente.exemplo.com.br" />
        </Field>
        <span />
        <Field label="Administrador — nome">
          <Input value={f.admin_name} onChange={set('admin_name')} />
        </Field>
        <Field label="Administrador — e-mail">
          <Input type="email" value={f.admin_email} onChange={set('admin_email')} />
        </Field>
      </div>
    </Dialog>
  );
}
