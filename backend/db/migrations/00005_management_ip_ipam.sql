ALTER TABLE devices ADD COLUMN IF NOT EXISTS management_ip_address_id uuid REFERENCES ip_addresses(id) ON DELETE SET NULL;

INSERT INTO ip_addresses(network_id,address,device_id,status,description)
SELECT (
  SELECT n.id FROM networks n WHERE n.prefix >>= d.management_ip ORDER BY masklen(n.prefix) DESC LIMIT 1
), d.management_ip, d.id, 'active', 'Imported management address'
FROM devices d
WHERE d.management_ip IS NOT NULL
ON CONFLICT(address) DO UPDATE SET device_id=COALESCE(ip_addresses.device_id,excluded.device_id);

UPDATE devices d SET management_ip_address_id=i.id
FROM ip_addresses i WHERE i.address=d.management_ip AND i.device_id=d.id;

CREATE UNIQUE INDEX IF NOT EXISTS devices_management_ip_address_unique
ON devices(management_ip_address_id) WHERE management_ip_address_id IS NOT NULL;

