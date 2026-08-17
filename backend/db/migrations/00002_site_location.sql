ALTER TABLE sites ADD COLUMN IF NOT EXISTS address_line text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS latitude numeric(9,6) CHECK (latitude BETWEEN -90 AND 90);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS longitude numeric(9,6) CHECK (longitude BETWEEN -180 AND 180);
CREATE INDEX IF NOT EXISTS sites_location_idx ON sites(country, state, city);

