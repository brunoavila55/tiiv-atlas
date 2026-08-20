-- +goose NO TRANSACTION
-- New role between 'admin' and 'viewer': can create/edit infrastructure
-- like 'admin', but cannot manage users. See internal/server/server.go's
-- validUserRole and writeRequired for where it takes effect.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'editor' AFTER 'admin';
