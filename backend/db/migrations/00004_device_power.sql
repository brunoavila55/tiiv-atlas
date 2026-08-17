ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_device_type_check;
ALTER TABLE devices ADD CONSTRAINT devices_device_type_check CHECK(device_type IN (
  'router','switch','server','firewall','olt','onu','storage','patch_panel','pdu','ups','wireless',
  'rectifier','inverter','battery_bank','generator','transfer_switch','other'
));
ALTER TABLE devices ADD COLUMN IF NOT EXISTS power_supply_count int NOT NULL DEFAULT 1 CHECK(power_supply_count BETWEEN 0 AND 8);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS power_input_voltage text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS power_capacity_watts int CHECK(power_capacity_watts IS NULL OR power_capacity_watts > 0);

