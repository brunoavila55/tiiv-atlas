-- +goose NO TRANSACTION
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin' BEFORE 'admin';
UPDATE users SET role='superadmin' WHERE role='admin';

