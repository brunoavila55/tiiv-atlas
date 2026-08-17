package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiiv/atlas/backend/internal/server"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
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
