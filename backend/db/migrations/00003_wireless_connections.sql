ALTER TABLE device_ports DROP CONSTRAINT IF EXISTS device_ports_type_check;
ALTER TABLE device_ports ADD CONSTRAINT device_ports_type_check
  CHECK (type IN ('ethernet','fiber','sfp','sfp_plus','qsfp','console','power','wireless','other'));

ALTER TABLE cables DROP CONSTRAINT IF EXISTS cables_cable_type_check;
ALTER TABLE cables ADD CONSTRAINT cables_cable_type_check
  CHECK (cable_type IN ('cat5e','cat6','cat6a','dac','fiber_sm','fiber_mm','power','wireless','other'));

