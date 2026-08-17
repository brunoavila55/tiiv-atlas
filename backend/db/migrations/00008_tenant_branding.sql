BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_name text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_data bytea;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_content_type text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_data bytea;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_content_type text;

COMMIT;
