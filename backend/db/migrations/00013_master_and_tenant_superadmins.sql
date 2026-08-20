ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'master' BEFORE 'superadmin';

-- PostgreSQL requires a newly-added enum value to be committed before use.
BEGIN;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_role_check;
UPDATE users SET role='master' WHERE role='superadmin' AND tenant_id IS NULL;
ALTER TABLE users ADD CONSTRAINT users_tenant_role_check CHECK (
  (role='master' AND tenant_id IS NULL) OR
  (role<>'master' AND tenant_id IS NOT NULL)
);

COMMIT;
