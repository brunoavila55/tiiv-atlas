#!/bin/sh
# Applies every not-yet-applied file in migrations/, in filename order,
# tracking what has already run in a schema_migrations table. That table is
# created on first use, so this is safe to run against a brand new database
# (first boot, via docker-entrypoint-initdb.d) and equally safe to re-run
# later against a database that already has some or all migrations applied
# (`make migrate`) — already-applied files are skipped instead of re-run.
set -e
: "${POSTGRES_USER:=atlas}"
: "${POSTGRES_DB:=tiiv_atlas}"
: "${MIGRATIONS_DIR:=/opt/atlas/migrations}"
PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"

for migration in "$MIGRATIONS_DIR"/*.sql; do
  name=$(basename "$migration")
  already=$($PSQL -tAc "SELECT 1 FROM schema_migrations WHERE id='$name'")
  if [ "$already" = "1" ]; then
    echo "migrate: $name already applied, skipping"
    continue
  fi
  echo "migrate: applying $name"
  $PSQL -f "$migration"
  $PSQL -c "INSERT INTO schema_migrations(id) VALUES ('$name')"
done
