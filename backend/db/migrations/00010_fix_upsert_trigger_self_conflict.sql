-- Fixes a false-positive rejection that `db/seed.sql` (and any future
-- upsert-style write) hits every time it is re-run against an already-seeded
-- database.
--
-- devices_rack_collision and cable_ports_unique were both BEFORE INSERT OR
-- UPDATE triggers that exclude "the row itself" from their own overlap check
-- by comparing against NEW.id (e.g. `d.id<>NEW.id`). For a plain INSERT or a
-- plain UPDATE that comparison is correct. For `INSERT ... ON CONFLICT DO
-- UPDATE` / `... DO NOTHING`, though, Postgres fires the BEFORE INSERT row
-- trigger for the row as originally proposed -- before it has determined
-- whether the row actually conflicts. At that point NEW.id is still the
-- freshly generated gen_random_uuid() default from the INSERT, not the id of
-- whatever pre-existing row it is about to conflict with. So `d.id<>NEW.id`
-- is trivially true for every existing row, including the very one this
-- upsert is targeting, and the trigger raises "rack position overlaps
-- another device" / "port already has an active connection" against an
-- upsert that isn't actually moving anything.
--
-- AFTER ROW triggers instead fire once against the row's real, final state:
-- for `DO UPDATE`, NEW is the merged row with the existing row's real id; for
-- `DO NOTHING` on a row that a matching unique constraint causes Postgres to
-- skip, the trigger does not fire at all, since no row was written. Neither
-- function assigns to NEW (they only validate and RAISE), so moving them from
-- BEFORE to AFTER changes nothing about what they reject -- a RAISE in an
-- AFTER trigger still aborts the whole statement and rolls back the write --
-- it only fixes when they see the row's real identity.
DROP TRIGGER IF EXISTS devices_rack_collision ON devices;
CREATE TRIGGER devices_rack_collision AFTER INSERT OR UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION validate_rack_placement();

DROP TRIGGER IF EXISTS cable_ports_unique ON cables;
CREATE TRIGGER cable_ports_unique AFTER INSERT OR UPDATE ON cables
  FOR EACH ROW EXECUTE FUNCTION validate_cable_ports();
