.PHONY: dev build test migrate migrate-down seed lint
dev:
	@if command -v docker >/dev/null 2>&1; then \
		docker compose -f docker-compose.dev.yml up --build; \
	else \
		podman compose -f docker-compose.dev.yml up --build; \
	fi
build:
	docker compose build
test:
	cd backend && go test ./...
	cd frontend && pnpm test -- --run
migrate:
	docker compose exec -T postgres sh /opt/atlas/migrate.sh
migrate-down:
	@echo "Migrations are append-only in the MVP; recreate the development volume if needed."
seed:
	docker compose exec -T postgres psql -U $${POSTGRES_USER:-atlas} -d $${POSTGRES_DB:-tiiv_atlas} -f /docker-entrypoint-initdb.d/002-seed.sql
lint:
	cd backend && go vet ./...
	cd frontend && pnpm lint
