-- Defense-in-depth backstop for tenant isolation.
--
-- Every CMDB/infrastructure table already carries a NOT NULL tenant_id (see
-- 00007_multitenancy.sql) and every handler in internal/server/server.go filters
-- on it explicitly. That manual filtering is still the primary mechanism and this
-- migration does not remove or replace it. What was missing is a database-level
-- guarantee that holds even if a query is ever written, generated, or edited
-- without that filter: Postgres row-level security, keyed off the app.tenant_id
-- session setting that internal/server.tenantScope pins on a dedicated connection
-- for every CMDB request (see cmd/api/main.go for the matching connection reset
-- on release back to the pool).
--
-- Deliberately NOT covered here: tenants, users, and sessions. Those tables have
-- legitimate cross-tenant reads baked into already-tested code paths (login looks
-- up a user by email before any tenant is known; a superadmin's session can list
-- or administer every tenant). Retrofitting RLS onto them needs its own careful,
-- separately-tested change; bolting it on here would risk breaking authentication.
BEGIN;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sites','rooms','racks','manufacturers','device_models','devices',
    'device_ports','cables','networks','ip_addresses','vlans',
    'vlan_assignments','tags','device_tags'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    -- FORCE is required because the application connects as the tables' owning
    -- role; without it, RLS silently would not apply to the app's own queries.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I ' ||
      'USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) ' ||
      'WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      tbl
    );
  END LOOP;
END $$;

COMMIT;
