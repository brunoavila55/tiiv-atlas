package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiiv/atlas/backend/internal/server"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	poolConfig, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Error("database configuration failed", "error", err)
		os.Exit(1)
	}
	// Request handlers pin a per-request connection's app.tenant_id session setting
	// to enforce the row-level security policies from migration 00009 (see
	// internal/server.tenantScope). Clear that setting before a connection goes
	// back into the idle pool so a later, unrelated request never inherits it.
	poolConfig.AfterRelease = func(c *pgx.Conn) bool {
		_, _ = c.Exec(context.Background(), `select set_config('app.tenant_id', '', false)`)
		return true
	}
	db, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		log.Error("database configuration failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err = db.Ping(ctx); err != nil {
		log.Error("database unavailable", "error", err)
		os.Exit(1)
	}
	if err = server.BootstrapAdmin(ctx, db, os.Getenv("ADMIN_NAME"), os.Getenv("ADMIN_EMAIL"), os.Getenv("ADMIN_PASSWORD")); err != nil {
		log.Error("administrator bootstrap failed", "error", err)
		os.Exit(1)
	}
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}
	srv := &http.Server{Addr: ":" + port, Handler: server.New(db, log, server.EnvSecure()), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	log.Info("api started", "port", port)
	if err = srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("api stopped", "error", err)
		os.Exit(1)
	}
}
