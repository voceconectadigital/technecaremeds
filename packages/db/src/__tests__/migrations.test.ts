/**
 * Aurora — reprodutibilidade do schema (EPIC-001).
 * "banco vazio -> migrations -> seeds -> testes" precisa funcionar sempre.
 */
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgliteAdapter } from '../adapters';
import { migrate, loadMigrations } from '../migrator';

describe('migrations (EPIC-001)', () => {
  it('aplica tudo do zero em banco vazio', async () => {
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);
    const r = await migrate(db);
    expect(r.applied.length).toBe(loadMigrations().length);
    expect(r.skipped).toEqual([]);
    await pg.close();
  });

  it('é idempotente — rodar de novo não reaplica nada', async () => {
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);
    await migrate(db);
    const second = await migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(loadMigrations().length);
    await pg.close();
  });

  it('detecta migration alterada depois de aplicada', async () => {
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);
    await migrate(db);
    await pg.query(`UPDATE aurora.schema_migrations SET checksum = 'adulterado' WHERE name = $1`, [
      loadMigrations()[0]!.name,
    ]);
    await expect(migrate(db)).rejects.toThrow(/alterada depois de aplicada/);
    await pg.close();
  });

  it('migrations são ordenadas e nomeadas de forma estável', () => {
    const names = loadMigrations().map((m) => m.name);
    expect(names).toEqual([...names].sort());
    names.forEach((n) => expect(n).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/));
  });

  it('registra o schema esperado', async () => {
    const pg = new PGlite();
    const db = pgliteAdapter(pg, null);
    await migrate(db);
    const { rows } = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='aurora' ORDER BY table_name`
    );
    // lista explícita: mudança de schema tem de ser deliberada, nunca silenciosa
    expect(rows.map((r) => r.table_name)).toEqual([
      'asset_categories',
      'asset_identifiers',
      'asset_models',
      'asset_transfers',
      'assets',
      'attachments',
      'audit_logs',
      'automation_actions',
      'automation_report_outputs',
      'automation_rules',
      'automation_tasks',
      'availability_blocks',
      'calendar_exceptions',
      'calendar_windows',
      'calendars',
      'catalog_definitions',
      'catalog_items',
      'catalog_references',
      'checklist_answer_revisions',
      'checklist_answers',
      'checklist_items',
      'checklist_responses',
      'checklist_sections',
      'checklist_template_instruments',
      'checklist_templates',
      'client_operations',
      'completion_requirements',
      'contract_coverages',
      'contract_periods',
      'contract_services',
      'contract_sla_overrides',
      'contracts',
      'criticality_levels',
      'custom_field_definitions',
      'customer_contacts',
      'customer_item_aliases',
      'customers',
      'document_signatures',
      'document_status_history',
      'document_types',
      'documents',
      'domain_events',
      'fact_work_order',
      'import_batches',
      'import_rows',
      'indicator_targets',
      'instrument_certificates',
      'instruments',
      'inventory_items',
      'location_types',
      'locations',
      'maintenance_plans',
      'manufacturers',
      'measurement_sessions',
      'membership_permission_overrides',
      'membership_registrations',
      'membership_roles',
      'membership_scopes',
      'memberships',
      'meter_readings',
      'meters',
      'notification_deliveries',
      'notification_preferences',
      'notifications',
      'number_sequences',
      'number_series',
      'opportunities',
      'opportunity_status_history',
      'organizations',
      'permissions',
      'plan_cycle_items',
      'plan_cycles',
      'plan_tasks',
      'platform_admins',
      'price_list_items',
      'price_lists',
      'quality_records',
      'quote_items',
      'quote_status_history',
      'quotes',
      'role_permissions',
      'roles',
      'rule_runs',
      'schema_migrations',
      'service_request_status_history',
      'service_requests',
      'signatures',
      'sla_clocks',
      'sla_pauses',
      'sla_policies',
      'sla_targets',
      'stock_balances',
      'stock_lots',
      'stock_movements',
      'stock_reservations',
      'store_order_events',
      'store_order_items',
      'store_orders',
      'suppliers',
      'team_members',
      'teams',
      'time_entries',
      'user_credentials',
      'user_sessions',
      'users',
      'wait_reasons',
      'warehouses',
      'work_order_comments',
      'work_order_customer_parts',
      'work_order_evaluations',
      'work_order_status_history',
      'work_order_status_transitions',
      'work_order_statuses',
      'work_order_type_settings',
      'work_order_visits',
      'work_orders',
    ]);
    await pg.close();
  });
});
