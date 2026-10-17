import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  FACTORY_ROLES,
  permissionsOfRole,
  effectivePermissions,
  escalationCheck,
  isOverPermissive,
  isKnownPermission,
  FIELD_LEVEL_PERMISSIONS,
} from '../permissions';

describe('catálogo de permissões (§21)', () => {
  it('não tem chave duplicada', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('toda chave segue recurso.ação', () => {
    PERMISSIONS.forEach((p) => {
      expect(p.key).toBe(`${p.resource}.${p.action}`);
      expect(p.key).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(p.description.length).toBeGreaterThan(5);
    });
  });

  it('é menor que as 138 do sistema de referência', () => {
    expect(PERMISSION_KEYS.length).toBeLessThan(138);
    expect(PERMISSION_KEYS.length).toBeGreaterThan(80);
  });

  it('permissões de campo estão declaradas', () => {
    expect(FIELD_LEVEL_PERMISSIONS).toContain('work_order.read_costs');
    expect(FIELD_LEVEL_PERMISSIONS).toContain('work_order.read_internal_notes');
    expect(FIELD_LEVEL_PERMISSIONS).toContain('insight.read_financial_metrics');
  });
});

describe('papéis de fábrica', () => {
  it('todos resolvem para permissões existentes', () => {
    FACTORY_ROLES.forEach((r) => expect(() => permissionsOfRole(r)).not.toThrow());
  });

  it('não têm chave duplicada', () => {
    const keys = FACTORY_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('Proprietário tem tudo; Administrador tudo menos faturamento', () => {
    const owner = permissionsOfRole(FACTORY_ROLES.find((r) => r.key === 'owner')!);
    const admin = permissionsOfRole(FACTORY_ROLES.find((r) => r.key === 'admin')!);
    expect(owner.length).toBe(PERMISSION_KEYS.length);
    expect(admin).not.toContain('organization.manage_billing');
    expect(owner).toContain('organization.manage_billing');
  });

  it('Técnico NÃO recebe o que a auditoria flagrou no sistema de referência', () => {
    const tech = permissionsOfRole(FACTORY_ROLES.find((r) => r.key === 'technician')!);
    // no Arkmeds o grupo "Técnico" tinha "adicionar empresa" e "adicionar grupo"
    expect(tech).not.toContain('customer.create');
    expect(tech).not.toContain('organization.manage_roles');
    expect(tech).not.toContain('maintenance_plan.create');
    expect(tech).not.toContain('work_order.read_costs');
    expect(tech).not.toContain('work_order.execute_any');
    expect(tech).toContain('work_order.execute');
  });

  it('nenhum papel operacional é excessivamente permissivo', () => {
    FACTORY_ROLES.filter((r) => !['owner', 'admin'].includes(r.key)).forEach((r) => {
      const perms = permissionsOfRole(r);
      expect(isOverPermissive(perms), `${r.key} detém ${perms.length}/${PERMISSION_KEYS.length}`).toBe(false);
    });
  });

  it('Auditor não escreve em lugar nenhum', () => {
    const auditor = permissionsOfRole(FACTORY_ROLES.find((r) => r.key === 'auditor')!);
    const writes = auditor.filter((k) => !k.endsWith('.read') && k !== 'audit.read');
    expect(writes).toEqual([]);
  });

  it('papéis de portal não alcançam dado interno', () => {
    FACTORY_ROLES.filter((r) => r.seatType === 'portal').forEach((r) => {
      const perms = permissionsOfRole(r);
      expect(perms).not.toContain('work_order.read_costs');
      expect(perms).not.toContain('work_order.read_internal_notes');
      expect(perms).not.toContain('audit.read');
      expect(perms).not.toContain('inventory.read_costs');
      expect(perms).not.toContain('supplier.read');
    });
  });

  it('Solicitante só escreve solicitação e aprova orçamento', () => {
    const req = permissionsOfRole(FACTORY_ROLES.find((r) => r.key === 'requester')!);
    const writes = req.filter((k) => !k.endsWith('.read'));
    // Pedir proposta na Store (16/10/2026) é a terceira escrita — vira oportunidade, não pedido.
    expect(writes.sort()).toEqual(['quote.approve', 'service_request.create', 'store.request_quote']);
  });
});

describe('resolução efetiva', () => {
  it('soma papéis', () => {
    const e = effectivePermissions([['asset.read'], ['asset.create']]);
    expect([...e].sort()).toEqual(['asset.create', 'asset.read']);
  });

  it('deny vence qualquer concessão, inclusive de papel', () => {
    const e = effectivePermissions(
      [['asset.read', 'asset.delete']],
      [{ permission: 'asset.delete', effect: 'deny' }]
    );
    expect(e.has('asset.delete')).toBe(false);
    expect(e.has('asset.read')).toBe(true);
  });

  it('deny vence grant declarado na mesma lista', () => {
    const e = effectivePermissions(
      [[]],
      [
        { permission: 'asset.delete', effect: 'grant' },
        { permission: 'asset.delete', effect: 'deny' },
      ]
    );
    expect(e.has('asset.delete')).toBe(false);
  });

  it('grant individual adiciona sem papel', () => {
    const e = effectivePermissions([[]], [{ permission: 'audit.read', effect: 'grant' }]);
    expect(e.has('audit.read')).toBe(true);
  });
});

describe('escalada de privilégio', () => {
  it('impede conceder o que não se tem', () => {
    const granter = new Set(['asset.read', 'asset.create']);
    expect(escalationCheck(granter, ['asset.read'])).toEqual([]);
    expect(escalationCheck(granter, ['asset.read', 'organization.manage_billing'])).toEqual([
      'organization.manage_billing',
    ]);
  });
});

describe('validação de chave', () => {
  it('reconhece apenas permissões do catálogo', () => {
    expect(isKnownPermission('asset.read')).toBe(true);
    expect(isKnownPermission('asset.teleport')).toBe(false);
  });
});

describe('administrativeEscalationCheck (pente-fino 17/10/2026)', () => {
  it('bloqueia conceder administração que não se tem; deixa delegar trabalho operacional', async () => {
    const { administrativeEscalationCheck, FACTORY_ROLES, permissionsOfRole } =
      await import('../permissions');
    const de = (k: string) => permissionsOfRole(FACTORY_ROLES.find((r) => r.key === k)!);
    const gestor = new Set(de('manager'));
    expect(administrativeEscalationCheck(gestor, de('operator'))).toEqual([]);
    expect(administrativeEscalationCheck(gestor, de('requester'))).toEqual([]);
    expect(administrativeEscalationCheck(gestor, de('admin'))).toContain('organization.manage_roles');
    expect(administrativeEscalationCheck(new Set(de('admin')), de('owner'))).toContain(
      'organization.manage_billing'
    );
  });
});
