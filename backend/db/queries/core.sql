-- name: GetSite :one
SELECT * FROM sites WHERE id = $1;
-- name: ListDevices :many
SELECT * FROM devices ORDER BY name LIMIT $1 OFFSET $2;
-- name: CreateDevice :one
INSERT INTO devices(name,device_type,site_id,rack_id,rack_position,rack_height,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *;

