#!/bin/sh
set -e

sh /opt/atlas/migrate.sh
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /opt/atlas/seed.sql
