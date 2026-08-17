BEGIN;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tenants(name,slug) VALUES('Default Organization','default') ON CONFLICT(slug) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT;
UPDATE users SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE role<>'superadmin' AND tenant_id IS NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_role_check;
ALTER TABLE users ADD CONSTRAINT users_tenant_role_check CHECK ((role='superadmin' AND tenant_id IS NULL) OR (role<>'superadmin' AND tenant_id IS NOT NULL));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE sessions s SET tenant_id=COALESCE(u.tenant_id,(SELECT id FROM tenants WHERE slug='default')) FROM users u WHERE u.id=s.user_id AND s.tenant_id IS NULL;
ALTER TABLE sessions ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE sites SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
ALTER TABLE sites ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS sites_tenant_slug_unique ON sites(tenant_id,slug);

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE rooms r SET tenant_id=s.tenant_id FROM sites s WHERE s.id=r.site_id AND r.tenant_id IS NULL;
ALTER TABLE rooms ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE racks ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE racks r SET tenant_id=s.tenant_id FROM sites s WHERE s.id=r.site_id AND r.tenant_id IS NULL;
ALTER TABLE racks ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE manufacturers SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
ALTER TABLE manufacturers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE manufacturers DROP CONSTRAINT IF EXISTS manufacturers_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturers_tenant_name_unique ON manufacturers(tenant_id,name);
ALTER TABLE device_models ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE device_models m SET tenant_id=x.tenant_id FROM manufacturers x WHERE x.id=m.manufacturer_id AND m.tenant_id IS NULL;
ALTER TABLE device_models ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE devices d SET tenant_id=s.tenant_id FROM sites s WHERE s.id=d.site_id AND d.tenant_id IS NULL;
ALTER TABLE devices ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE device_ports ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE device_ports p SET tenant_id=d.tenant_id FROM devices d WHERE d.id=p.device_id AND p.tenant_id IS NULL;
ALTER TABLE device_ports ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE cables ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE cables c SET tenant_id=p.tenant_id FROM device_ports p WHERE p.id=c.port_a_id AND c.tenant_id IS NULL;
ALTER TABLE cables ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE networks ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE networks n SET tenant_id=COALESCE(s.tenant_id,(SELECT id FROM tenants WHERE slug='default')) FROM sites s WHERE s.id=n.site_id AND n.tenant_id IS NULL;
UPDATE networks SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
ALTER TABLE networks ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE networks DROP CONSTRAINT IF EXISTS networks_prefix_key;
CREATE UNIQUE INDEX IF NOT EXISTS networks_tenant_prefix_unique ON networks(tenant_id,prefix);
ALTER TABLE ip_addresses ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE ip_addresses i SET tenant_id=n.tenant_id FROM networks n WHERE n.id=i.network_id AND i.tenant_id IS NULL;
UPDATE ip_addresses i SET tenant_id=d.tenant_id FROM devices d WHERE d.id=i.device_id AND i.tenant_id IS NULL;
UPDATE ip_addresses SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
ALTER TABLE ip_addresses ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE ip_addresses DROP CONSTRAINT IF EXISTS ip_addresses_address_key;
CREATE UNIQUE INDEX IF NOT EXISTS ip_addresses_tenant_address_unique ON ip_addresses(tenant_id,address);

ALTER TABLE vlans ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE vlans v SET tenant_id=COALESCE(s.tenant_id,(SELECT id FROM tenants WHERE slug='default')) FROM sites s WHERE s.id=v.site_id AND v.tenant_id IS NULL;
UPDATE vlans SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
ALTER TABLE vlans ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE vlans DROP CONSTRAINT IF EXISTS vlans_site_id_vid_key;
CREATE UNIQUE INDEX IF NOT EXISTS vlans_tenant_site_vid_unique ON vlans(tenant_id,site_id,vid) NULLS NOT DISTINCT;
ALTER TABLE vlan_assignments ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE vlan_assignments a SET tenant_id=v.tenant_id FROM vlans v WHERE v.id=a.vlan_id AND a.tenant_id IS NULL;
ALTER TABLE vlan_assignments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE tags SET tenant_id=(SELECT id FROM tenants WHERE slug='default') WHERE tenant_id IS NULL;
ALTER TABLE tags ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS tags_tenant_name_unique ON tags(tenant_id,name);

CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);
CREATE INDEX IF NOT EXISTS devices_tenant_idx ON devices(tenant_id);
CREATE INDEX IF NOT EXISTS ports_tenant_idx ON device_ports(tenant_id);
CREATE INDEX IF NOT EXISTS cables_tenant_idx ON cables(tenant_id);
CREATE INDEX IF NOT EXISTS ip_addresses_tenant_idx ON ip_addresses(tenant_id);

ALTER TABLE sites ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE rooms ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE racks ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE manufacturers ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE device_models ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE devices ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE device_ports ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE cables ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE networks ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE ip_addresses ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE vlans ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE vlan_assignments ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;
ALTER TABLE tags ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;

ALTER TABLE device_tags ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE device_tags x SET tenant_id=d.tenant_id FROM devices d WHERE d.id=x.device_id AND x.tenant_id IS NULL;
ALTER TABLE device_tags ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE device_tags ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting('app.tenant_id',true),'')::uuid;

CREATE OR REPLACE FUNCTION enforce_same_tenant_fk() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reference_id uuid; valid boolean;
BEGIN
  reference_id := nullif(to_jsonb(NEW)->>TG_ARGV[0],'')::uuid;
  IF reference_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE id=$1 AND tenant_id=$2)',TG_ARGV[1]) INTO valid USING reference_id,NEW.tenant_id;
  IF NOT valid THEN RAISE EXCEPTION 'cross-tenant reference is not allowed'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rooms_tenant_site ON rooms; CREATE TRIGGER rooms_tenant_site BEFORE INSERT OR UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('site_id','sites');
DROP TRIGGER IF EXISTS racks_tenant_site ON racks; CREATE TRIGGER racks_tenant_site BEFORE INSERT OR UPDATE ON racks FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('site_id','sites');
DROP TRIGGER IF EXISTS racks_tenant_room ON racks; CREATE TRIGGER racks_tenant_room BEFORE INSERT OR UPDATE ON racks FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('room_id','rooms');
DROP TRIGGER IF EXISTS models_tenant_manufacturer ON device_models; CREATE TRIGGER models_tenant_manufacturer BEFORE INSERT OR UPDATE ON device_models FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('manufacturer_id','manufacturers');
DROP TRIGGER IF EXISTS devices_tenant_site ON devices; CREATE TRIGGER devices_tenant_site BEFORE INSERT OR UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('site_id','sites');
DROP TRIGGER IF EXISTS devices_tenant_room ON devices; CREATE TRIGGER devices_tenant_room BEFORE INSERT OR UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('room_id','rooms');
DROP TRIGGER IF EXISTS devices_tenant_rack ON devices; CREATE TRIGGER devices_tenant_rack BEFORE INSERT OR UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('rack_id','racks');
DROP TRIGGER IF EXISTS devices_tenant_manufacturer ON devices; CREATE TRIGGER devices_tenant_manufacturer BEFORE INSERT OR UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('manufacturer_id','manufacturers');
DROP TRIGGER IF EXISTS devices_tenant_model ON devices; CREATE TRIGGER devices_tenant_model BEFORE INSERT OR UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('device_model_id','device_models');
DROP TRIGGER IF EXISTS devices_tenant_management_ip ON devices; CREATE TRIGGER devices_tenant_management_ip BEFORE INSERT OR UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('management_ip_address_id','ip_addresses');
DROP TRIGGER IF EXISTS ports_tenant_device ON device_ports; CREATE TRIGGER ports_tenant_device BEFORE INSERT OR UPDATE ON device_ports FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('device_id','devices');
DROP TRIGGER IF EXISTS cables_tenant_port_a ON cables; CREATE TRIGGER cables_tenant_port_a BEFORE INSERT OR UPDATE ON cables FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('port_a_id','device_ports');
DROP TRIGGER IF EXISTS cables_tenant_port_b ON cables; CREATE TRIGGER cables_tenant_port_b BEFORE INSERT OR UPDATE ON cables FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('port_b_id','device_ports');
DROP TRIGGER IF EXISTS networks_tenant_site ON networks; CREATE TRIGGER networks_tenant_site BEFORE INSERT OR UPDATE ON networks FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('site_id','sites');
DROP TRIGGER IF EXISTS ips_tenant_network ON ip_addresses; CREATE TRIGGER ips_tenant_network BEFORE INSERT OR UPDATE ON ip_addresses FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('network_id','networks');
DROP TRIGGER IF EXISTS ips_tenant_device ON ip_addresses; CREATE TRIGGER ips_tenant_device BEFORE INSERT OR UPDATE ON ip_addresses FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('device_id','devices');
DROP TRIGGER IF EXISTS ips_tenant_port ON ip_addresses; CREATE TRIGGER ips_tenant_port BEFORE INSERT OR UPDATE ON ip_addresses FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('port_id','device_ports');
DROP TRIGGER IF EXISTS vlans_tenant_site ON vlans; CREATE TRIGGER vlans_tenant_site BEFORE INSERT OR UPDATE ON vlans FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('site_id','sites');
DROP TRIGGER IF EXISTS assignments_tenant_port ON vlan_assignments; CREATE TRIGGER assignments_tenant_port BEFORE INSERT OR UPDATE ON vlan_assignments FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('port_id','device_ports');
DROP TRIGGER IF EXISTS assignments_tenant_vlan ON vlan_assignments; CREATE TRIGGER assignments_tenant_vlan BEFORE INSERT OR UPDATE ON vlan_assignments FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('vlan_id','vlans');
DROP TRIGGER IF EXISTS device_tags_tenant_device ON device_tags; CREATE TRIGGER device_tags_tenant_device BEFORE INSERT OR UPDATE ON device_tags FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('device_id','devices');
DROP TRIGGER IF EXISTS device_tags_tenant_tag ON device_tags; CREATE TRIGGER device_tags_tenant_tag BEFORE INSERT OR UPDATE ON device_tags FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant_fk('tag_id','tags');

COMMIT;
