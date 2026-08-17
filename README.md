# Tiiv Atlas

**Infrastructure Management — infrastructure at a glance.**

Tiiv Atlas is a focused, self-hosted application for documenting sites, rooms, racks, devices, ports, cables, IP space, and VLANs. It favors visual navigation and quick data entry over CMDB complexity.

## Architecture

- React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, and React Flow
- Go 1.26, chi, pgx, PostgreSQL, REST/JSON, structured `slog` logging
- PostgreSQL constraints protect rack placement, cable endpoints, IP uniqueness, and VLAN ranges
- HTTP-only cookie sessions with admin, operator, and viewer roles
- nginx serves the SPA and proxies `/api` to the Go service

## Quick start

Requirements: Docker 24+ with Compose v2.

```bash
cp .env.example .env
docker compose up -d --build
```

Open `http://localhost:3000`. The development seed account is `admin@tiiv.local` / `atlas123`; change it before exposing the app.

## Production deployment

Use the production Compose file. It does not load demo data or the known development password.

```bash
cp .env.example .env
# Set strong, unique POSTGRES_PASSWORD and ADMIN_PASSWORD values.
# Set DATABASE_URL with the same PostgreSQL credentials.
docker compose -f docker-compose.prod.yml up -d --build
```

`ADMIN_EMAIL` and an `ADMIN_PASSWORD` of at least 12 characters create the first administrator only when the users table is empty. They do not overwrite an existing account.

The web service binds to `127.0.0.1:3000` by default. Put an HTTPS reverse proxy such as Caddy, nginx, Traefik, or Cloudflare Tunnel in front of it. To publish directly on another interface, explicitly set `WEB_BIND`, but TLS remains required because production cookies are Secure.

Back up the `atlas-postgres` volume regularly. Before upgrades, take a PostgreSQL dump and apply new numbered files from `backend/db/migrations` in order. The baseline migration initializes a new production database; development seed data is never mounted by the production Compose file.

The named `atlas-postgres` volume persists data. The initial schema and seed are applied automatically only when the volume is first created.

## Local development

Run PostgreSQL with Compose, then:

```bash
cd backend && DATABASE_URL='postgres://atlas:atlas_change_me@localhost:5432/tiiv_atlas?sslmode=disable' go run ./cmd/api
cd frontend && pnpm install && pnpm dev
```

The Vite server proxies API calls to port 8080. Useful targets include `make test`, `make build`, `make lint`, `make migrate`, and `make seed`.

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection URL | Compose service URL |
| `SESSION_SECRET` | Reserved for session-key rotation | development value |
| `COOKIE_SECURE` | Require HTTPS for cookies | `false` |
| `API_PORT` | API listen port | `8080` |
| `WEB_PORT` | Published web port | `3000` |

## Database and sqlc

The baseline migration is in `backend/db/migrations`, seed data is in `backend/db/seed.sql`, and typed-query sources are in `backend/db/queries`. Run `sqlc generate` from `backend` after changing query definitions. Add new numbered migrations instead of editing a production-applied migration.

## API overview

All application routes are under `/api/v1`. Resources include sites, rooms, racks, manufacturers, device models, devices, ports, connections, networks, IP addresses, and VLANs. The API also exposes `/dashboard`, `/topology`, `/search?q=`, and authentication routes. Responses use `{ "data": ... }`; errors use `{ "error": { "code", "message" } }`. `GET /health` checks API and database readiness.

List endpoints accept `page` and `page_size` (up to 100). The device and network screens are structured to add more server-side filters without a global client store.

## Security notes

Passwords use bcrypt in PostgreSQL seed data and Go verification. Sessions are opaque UUIDs stored server-side, cookies are HTTP-only and SameSite=Lax, request bodies are limited, SQL values are parameterized, and baseline security headers are applied. Enable `COOKIE_SECURE=true`, use TLS at the reverse proxy, replace all example credentials, and restrict database exposure in production.

## Screenshots

Screenshots will be added after the first tagged release.

## Roadmap

- Complete resource-specific create/edit forms and richer validation messages
- CSV and NetBox import/export
- Patch-panel cable tracing and saved topology layouts
- Audit log, API tokens, and attachments
- Optional discovery and Tiiv Monitor integrations

## License

MIT — see [LICENSE](LICENSE).
