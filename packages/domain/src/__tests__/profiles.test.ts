import { describe, expect, it } from 'vitest';
import {
  BUSINESS_PROFILES,
  FACTORY_ROLES,
  PERMISSION_KEYS,
  canChangeAccessState,
  isOverPermissive,
  isValidCpf,
  maskCpf,
  formatCpf,
  isValidRegistrationNumber,
  permissionsOfRole,
  profileOfRoles,
} from '../index';

const papel = (k: string) => permissionsOfRole(FACTORY_ROLES.find((r) => r.key === k)!);

describe('perfis de acesso (reunião 16/10/2026)', () => {
  it('são exatamente Operador, Solicitante e Gestor, cada um sobre um papel de fábrica', () => {
    expect(BUSINESS_PROFILES.map((p) => p.label)).toEqual(['Operador', 'Solicitante', 'Gestor']);
    for (const p of BUSINESS_PROFILES) {
      const role = FACTORY_ROLES.find((r) => r.key === p.roleKey);
      expect(role, p.key).toBeDefined();
      expect(role!.seatType).toBe(p.seatType);
    }
  });

  it('Solicitante não cadastra cliente, equipamento, plano, checklist nem mexe em estoque', () => {
    const req = papel('requester');
    for (const k of [
      'customer.create',
      'asset.create',
      'maintenance_plan.create',
      'procedure.create',
      'inventory.move',
      'inventory.create',
      'organization.manage_members',
      'service_request.triage',
    ]) {
      expect(req).not.toContain(k);
    }
    expect(req).toContain('service_request.create');
  });

  it('Operador executa, mas não cadastra cliente/plano/checklist nem faz triagem', () => {
    const op = papel('operator');
    expect(op).toContain('work_order.execute');
    expect(op).toContain('inventory.move');
    for (const k of [
      'customer.create',
      'maintenance_plan.create',
      'procedure.create',
      'service_request.triage',
    ]) {
      expect(op).not.toContain(k);
    }
  });

  it('Gestor gerencia estoque, orçamento e usuários, mas não é administrador da plataforma', () => {
    const g = papel('manager');
    for (const k of ['inventory.adjust', 'quote.approve', 'organization.manage_members', 'insight.read']) {
      expect(g).toContain(k);
    }
    for (const k of [
      'organization.manage_billing',
      'organization.manage_roles',
      'organization.manage_integrations',
    ]) {
      expect(g).not.toContain(k);
    }
    expect(isOverPermissive(g), `${g.length}/${PERMISSION_KEYS.length}`).toBe(false);
  });

  it('o perfil é reconhecido pelos papéis do vínculo', () => {
    expect(profileOfRoles(['manager'])?.label).toBe('Gestor');
    expect(profileOfRoles(['technician'])).toBeUndefined();
  });
});

describe('CPF', () => {
  it('valida dígitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
  it('mascara e formata', () => {
    expect(maskCpf('52998224725')).toBe('***.982.247-**');
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
  });
});

describe('registro profissional', () => {
  it('aceita números usuais e recusa lixo', () => {
    expect(isValidRegistrationNumber('123456')).toBe(true);
    expect(isValidRegistrationNumber('SP-123.456')).toBe(true);
    expect(isValidRegistrationNumber(' ')).toBe(false);
    expect(isValidRegistrationNumber('a b c')).toBe(false);
  });
});

describe('situação do acesso', () => {
  it('ativo ↔ suspenso ↔ bloqueado, nunca a partir de removido', () => {
    expect(canChangeAccessState('active', 'suspended')).toBe(true);
    expect(canChangeAccessState('active', 'blocked')).toBe(true);
    expect(canChangeAccessState('blocked', 'active')).toBe(true);
    expect(canChangeAccessState('suspended', 'active')).toBe(true);
    expect(canChangeAccessState('active', 'active')).toBe(false);
    expect(canChangeAccessState('removed', 'active')).toBe(false);
  });
});
