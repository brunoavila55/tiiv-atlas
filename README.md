# Tiiv Atlas

**Infrastructure Management — infrastructure at a glance.**

Tiiv Atlas is a focused, self-hosted application for documenting sites, rooms, racks, devices, ports, cables, IP space, and VLANs. It favors visual navigation and quick data entry over CMDB complexity.

## Architecture

- React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, and React Flow
- Go 1.26, chi, pgx, PostgreSQL, REST/JSON, structured `slog` logging
- PostgreSQL constraints protect rack placement, cable endpoints, IP uniqueness, and VLAN ranges
- Organization-based multitenancy with API filtering and database-enforced cross-tenant reference protection
- Role-based access with superadministrator, administrator, and viewer accounts
- nginx serves the SPA and proxies `/api` to the Go service

## Production quick start

Requirements: Docker 24+ with Compose v2.

```bash
cp .env.example .env
docker compose up -d --build
```

Set strong, unique database and administrator credentials in `.env`, then run the command above. Open `http://VM_ADDRESS:15467` or configure Nginx Proxy Manager to forward to that address and port.

## Production deployment

The default Compose file is production-ready. It does not load demo data or the known development password.

```bash
cp .env.example .env
# Set strong, unique POSTGRES_PASSWORD and ADMIN_PASSWORD values.
# Set DATABASE_URL with the same PostgreSQL credentials.
docker compose up -d --build
```

`ADMIN_EMAIL` and an `ADMIN_PASSWORD` of at least 12 characters create the first administrator only when the users table is empty. They do not overwrite an existing account.

The production stack publishes only the web gateway on port `15467` by default. PostgreSQL and the Go API have no host ports and remain accessible only through the Compose network. Start the complete stack with:

```bash
docker compose up -d --build
```

Configure Nginx Proxy Manager with scheme `http`, the VM's LAN address as the forward hostname, and port `15467`. TLS terminates at Nginx Proxy Manager. Change `WEB_PORT` in `.env` if another host port is required; use a firewall to restrict direct access to that port when appropriate.

Back up the `atlas-postgres` volume regularly. Before upgrades, take a PostgreSQL dump and apply new numbered files from `backend/db/migrations` in order. The baseline migration initializes a new production database; development seed data is never mounted by the production Compose file.

For an existing installation, apply the multitenancy migration after the backup. It preserves existing records and assigns them to `Default Organization`:

```bash
docker compose exec postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/00007_multitenancy.sql'
```

The named `atlas-postgres` volume persists data. The initial schema and seed are applied automatically only when the volume is first created.

## Local development

For the seeded local stack, use `docker compose -f docker-compose.dev.yml up -d --build`. Alternatively, run PostgreSQL and the application processes separately:

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
| `WEB_BIND` | Interface used by the production web gateway | `0.0.0.0` |
| `WEB_PORT` | Published web port (`3000` in development Compose) | `15467` in production |

## Database and sqlc

The baseline migration is in `backend/db/migrations`, seed data is in `backend/db/seed.sql`, and typed-query sources are in `backend/db/queries`. Run `sqlc generate` from `backend` after changing query definitions. Add new numbered migrations instead of editing a production-applied migration.

## API overview

All application routes are under `/api/v1`. Resources include sites, rooms, racks, manufacturers, device models, devices, ports, connections, networks, IP addresses, and VLANs. The API also exposes `/dashboard`, `/topology`, `/search?q=`, and authentication routes. Responses use `{ "data": ... }`; errors use `{ "error": { "code", "message" } }`. `GET /health` checks API and database readiness.

List endpoints accept `page` and `page_size` (up to 100). The device and network screens are structured to add more server-side filters without a global client store.

## Security notes

Passwords use bcrypt in PostgreSQL seed data and Go verification. Sessions are opaque UUIDs stored server-side, cookies are HTTP-only and SameSite=Lax, request bodies are limited, SQL values are parameterized, and baseline security headers are applied. Enable `COOKIE_SECURE=true`, use TLS at the reverse proxy, replace all example credentials, and restrict database exposure in production.

### User roles

- `superadmin`: global installation access, organization switching, organization creation, and user administration.
- `admin`: creates and edits infrastructure only in the organization assigned to the account.
- `viewer`: read-only access only in the assigned organization; write actions are hidden in the interface and rejected by the API.

Tiiv Atlas prevents deleting the current account and prevents deleting or demoting the final superadministrator. Every user can change their own password from the account menu; changing it revokes their other sessions.

### Multitenancy

Sites, rooms, racks, devices, models, ports, connections, IPAM, VLANs, and tags belong to one organization. Every authenticated session carries an active organization, every resource query includes that organization, and PostgreSQL triggers reject foreign-key relationships across organizations. Tenant identifiers supplied by clients are ignored on create and update.

Superadministrators are global and choose the active organization from **Organizations**. Administrators and viewers are permanently bound to their assigned organization and cannot switch context. User email addresses remain globally unique so one identity cannot ambiguously belong to multiple organizations.

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
