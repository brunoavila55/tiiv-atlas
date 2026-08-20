# Tiiv Atlas

**Infrastructure Management — infrastructure at a glance.**

Tiiv Atlas is a focused, self-hosted application for documenting sites, rooms, racks, devices, ports, cables, IP space, and VLANs. It favors visual navigation and quick data entry over CMDB complexity.

## Architecture

- React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, and React Flow
- Go 1.26, chi, pgx, PostgreSQL, REST/JSON, structured `slog` logging
- PostgreSQL constraints protect rack placement, cable endpoints, IP uniqueness, and VLAN ranges
- Organization-based multitenancy with API filtering and database-enforced cross-tenant reference protection
- Per-organization white label with custom portal name, logo, and favicon
- Role-based access with superadministrator, administrator, and viewer accounts
- nginx serves the SPA and proxies `/api` to the Go service
- phpIPAM-style address grid per network, with automatic subnet nesting and IPv4/IPv6 support (see [IP address management](#ip-address-management-ipam) below)

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

Atlas does not require a specific reverse proxy. Point Nginx Proxy Manager, Nginx, Traefik, Caddy, HAProxy, a tunnel, or a load balancer to the host running Atlas on port `15467` using HTTP. Preserve the original `Host` header and the standard `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` headers. Change `WEB_PORT` in `.env` if another host port is required; use `WEB_BIND=127.0.0.1` when the proxy runs on the same host, or a firewall when the gateway must listen on the LAN.

Direct HTTP access works with the defaults. When TLS terminates at a reverse proxy, set `COOKIE_SECURE=true` so session cookies are sent only over HTTPS.

### Tenant subdomains

`APP_BASE_DOMAIN` is empty by default, so Atlas accepts any hostname and does not depend on a particular DNS or proxy setup. Set it to a hostname such as `atlas.example.com` only when host-based tenant portals are wanted. The base address becomes the global superadministrator control center and each organization slug becomes a portal such as `newlife.atlas.example.com`. Login and every authenticated API request then verify that the hostname matches the user's organization; an unknown or mismatched subdomain is rejected.

For tenant subdomains, create DNS records for the base hostname and its wildcard, point both at the chosen reverse proxy, and use a certificate covering both names. Wildcard Let's Encrypt certificates normally require a supported DNS challenge. A single wildcard proxy route is sufficient; tenant-specific containers or proxy entries are not required.

Back up the `atlas-postgres` volume regularly. The named `atlas-postgres` volume persists data, and every file in `backend/db/migrations` runs automatically, in order, only when that volume is first created (a brand new production database). For an existing installation, take a backup and then run `make migrate`: it tracks which migration files have already run in a `schema_migrations` table and applies only the ones that haven't, in filename order, so it's safe to run after every upgrade regardless of how far behind the installation is.

## Local development

For the seeded local stack, use `docker compose -f docker-compose.dev.yml up -d --build`. Alternatively, run PostgreSQL and the application processes separately:

```bash
cd backend && DATABASE_URL='postgres://atlas:atlas_change_me@localhost:5432/tiiv_atlas?sslmode=disable' go run ./cmd/api
cd frontend && pnpm install && pnpm dev
```

The Vite server proxies API calls to port 8080. Useful targets include `make test`, `make build`, `make lint`, `make seed` (re-applies `backend/db/seed.sql` against the running dev database; safe to run repeatedly), and `make migrate` (applies every file in `backend/db/migrations` that hasn't run yet against the running dev database, tracked in a `schema_migrations` table; safe to run repeatedly since already-applied files are skipped). `make dev`, `make migrate`, and `make seed` fall back to `podman compose` automatically when the `docker` binary isn't present, so the same commands work on a local Podman setup.

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection URL | Compose service URL |
| `SESSION_SECRET` | Reserved for session-key rotation | development value |
| `COOKIE_SECURE` | Require HTTPS for cookies; enable when TLS terminates at a reverse proxy | `false` |
| `APP_BASE_DOMAIN` | Optional base hostname for the superadmin portal and tenant subdomains; empty disables hostname enforcement | empty |
| `API_PORT` | API listen port | `8080` |
| `WEB_BIND` | Interface used by the production web gateway | `0.0.0.0` |
| `WEB_PORT` | Published web port (`3000` in development Compose) | `15467` in production |

## Database and sqlc

The baseline migration is in `backend/db/migrations`, seed data is in `backend/db/seed.sql`, and typed-query sources are in `backend/db/queries`. `sqlc.yaml` reads the whole `backend/db/migrations` directory as schema, so generated code always reflects every applied migration, not just the baseline. Run `sqlc generate` from `backend` after changing query definitions. Add new numbered migrations instead of editing a production-applied migration.

Migration `00010_fix_upsert_trigger_self_conflict.sql` switches the `devices_rack_collision` and `cable_ports_unique` triggers from `BEFORE` to `AFTER`. Postgres fires a `BEFORE INSERT` trigger against a row's proposed identity before `ON CONFLICT` resolves it, so every upsert (including re-running `seed.sql`) was falsely rejected as colliding with itself; genuine rack overlaps and duplicate port cabling are still rejected after the fix.

Migration `00011_ip_assigned_to.sql` adds a nullable `assigned_to` text column to `ip_addresses`, so an address can be documented against a free-text name instead of (or alongside) a `device_id`.

## API overview

All application routes are under `/api/v1`. Resources include sites, rooms, racks, manufacturers, device models, devices, ports, connections, networks, IP addresses, and VLANs. The API also exposes `/dashboard`, `/topology`, `/search?q=`, and authentication routes. Responses use `{ "data": ... }`; errors use `{ "error": { "code", "message" } }`. `GET /health` checks API and database readiness.

List endpoints accept `page` and `page_size` (up to 100) and return a `meta.total` row count for the active organization alongside `meta.page`/`meta.page_size`, so clients can build page controls without a separate count query. The device and network screens are structured to add more server-side filters without a global client store.

## IP address management (IPAM)

Opening a network from **IP Management → Networks** shows `GET /networks/{id}/addresses`, a phpIPAM-style grid of that prefix's address space:

- **IPv4** prefixes are expanded into one row per address (network and broadcast addresses are labeled, not hidden), so free and used addresses are visible at a glance without pre-creating a row per IP. Prefixes are capped at a `/20` (4,096 addresses); a larger prefix returns a `PREFIX_TOO_LARGE` error asking it to be narrowed or split.
- **IPv6** prefixes are never expanded — a `/64` already has 2⁶⁴ addresses, so the grid instead lists only the addresses someone has explicitly documented, with an **Add address** action to type one in directly.
- Any address can be assigned to a device already in inventory, to a free-text `assigned_to` name (e.g. a customer an IP was handed to, with no device involved), or left with neither and a `reserved`/`available` status.

**Nested subnets** work by CIDR containment alone — there is no `parent_id` column. Creating `10.0.0.0/21` and `10.0.0.0/27` (or `2001:db8::/32` and `2001:db8:1::/48`) automatically links the narrower prefix under the wider one, in either creation order and at any depth, because the backend re-derives the relationship from Postgres's `cidr` `<<`/`>>` containment operators on every read. The **Networks** list renders the full hierarchy as a tree (indentation, a connector icon, and a subnet-count badge); a network's detail page shows a "Subnet of …" link up to its parent, a chip list of subnets nested inside it, and rolls a subnet's assigned addresses up into the parent's utilization count (tagged "via …" so it's clear where the assignment actually lives). An **Add subnet** button on the detail page creates a new network pre-scoped to nest inside the current one, with an inline live check confirming the prefix actually falls inside it before saving.

## Security notes

Passwords use bcrypt in PostgreSQL seed data and Go verification. Sessions are opaque UUIDs stored server-side, cookies are HTTP-only and SameSite=Lax, request bodies are limited, SQL values are parameterized, and baseline security headers are applied. Enable `COOKIE_SECURE=true`, use TLS at the reverse proxy, replace all example credentials, and restrict database exposure in production.

### User roles

- `superadmin`: global installation access, organization switching, organization creation, and user administration.
- `admin`: creates and edits infrastructure only in the organization assigned to the account.
- `viewer`: read-only access only in the assigned organization; write actions are hidden in the interface and rejected by the API.

Tiiv Atlas prevents deleting the current account and prevents deleting or demoting the final superadministrator. Every user can change their own password from the account menu; changing it revokes their other sessions.

### Multitenancy

Sites, rooms, racks, devices, models, ports, connections, IPAM, VLANs, and tags belong to one organization. Every authenticated session carries an active organization, every resource query includes that organization, and PostgreSQL triggers reject foreign-key relationships across organizations. Tenant identifiers supplied by clients are ignored on create and update.

As a database-level backstop to that application-level filtering, migration `00009_row_level_security.sql` enables Postgres row-level security on every CMDB/infrastructure table. Each request to those tables runs on a dedicated connection with `app.tenant_id` pinned to the caller's active organization (see `internal/server.tenantScope`), so a query that ever omitted its own tenant filter would still be blocked by Postgres rather than returning or accepting another organization's rows. The `tenants`, `users`, and `sessions` tables are intentionally not covered, since login and superadministrator flows need legitimate cross-tenant lookups.

Superadministrators are global and land in the **Organizations** control center after signing in. From there they create or edit companies, review site/device/user totals, manage each company's users, and explicitly enter its isolated workspace. Administrators and viewers land directly in their assigned workspace and cannot switch context. User email addresses remain globally unique so one identity cannot ambiguously belong to multiple organizations.

Each organization can have an optional white-label name, logo, and favicon configured from **Organizations → Branding**. PNG, JPEG, and WebP logos up to 2 MB are accepted; favicons may also use ICO and are limited to 256 KB. Branding assets are stored in PostgreSQL, served only from the matching tenant portal, and applied automatically to the login screen, sidebar, browser title, and favicon. The API applies the branding columns idempotently at startup, so an existing installation only needs the normal `docker compose up -d --build` upgrade.

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
