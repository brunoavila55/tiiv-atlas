-- These are reference queries for sqlc codegen (see ../../sqlc.yaml) and are not
-- currently wired into the running API: internal/server/server.go issues its own
-- parameterized SQL directly. Every query here still must carry tenant_id, exactly
-- like the handwritten queries in server.go, so that generated code is never a
-- shortcut around tenant isolation if it gets adopted later.

-- name: GetSite :one
SELECT * FROM sites WHERE id = $1 AND tenant_id = $2;
-- name: ListDevices :many
SELECT * FROM devices WHERE tenant_id = $1 ORDER BY name LIMIT $2 OFFSET $3;
-- name: CreateDevice :one
INSERT INTO devices(tenant_id,name,device_type,site_id,rack_id,rack_position,rack_height,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *;
