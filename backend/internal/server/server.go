package server

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Server struct {
	db         *pgxpool.Pool
	log        *slog.Logger
	secure     bool
	baseDomain string
}

func BootstrapAdmin(ctx context.Context, db *pgxpool.Pool, name, email, password string) error {
	if _, err := db.Exec(ctx, `alter table tenants add column if not exists brand_name text;
		alter table tenants add column if not exists logo_data bytea;
		alter table tenants add column if not exists logo_content_type text;
		alter table tenants add column if not exists favicon_data bytea;
		alter table tenants add column if not exists favicon_content_type text`); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `insert into tenants(name,slug) select 'Default Organization','default' where not exists(select 1 from tenants)`); err != nil {
		return err
	}
	var count int
	if err := db.QueryRow(ctx, `select count(*) from users`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if len(password) < 12 || !strings.Contains(email, "@") {
		return fmt.Errorf("ADMIN_EMAIL and ADMIN_PASSWORD (minimum 12 characters) are required for the first production start")
	}
	if name == "" {
		name = "Atlas Administrator"
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `insert into users(name,email,password_hash,role) values($1,$2,$3,'master')`, name, strings.ToLower(strings.TrimSpace(email)), string(hash))
	return err
}

type ctxKey string

const userKey ctxKey = "user"
const tenantKey ctxKey = "tenant"
const connKey ctxKey = "conn"

// querier is satisfied by both *pgxpool.Pool and *pgxpool.Conn, so request handlers
// can be handed either a pool-wide connection (administrative/tenant/user tables,
// which are not tenant-partitioned) or a per-request connection that has
// app.tenant_id set for the caller's active tenant (CMDB/infrastructure tables,
// which carry a database-enforced row-level-security policy keyed on that setting).
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

// q returns the request-scoped, tenant-pinned database connection set up by
// tenantScope for CMDB/infrastructure handlers. Handlers that operate on
// tenants/users/sessions (which are not covered by row-level security) should
// keep using s.db directly.
func (s *Server) q(r *http.Request) querier {
	if c, ok := r.Context().Value(connKey).(*pgxpool.Conn); ok {
		return c
	}
	return s.db
}

// tenantScope acquires a dedicated connection from the pool for the lifetime of
// the request and pins Postgres's app.tenant_id session setting to the caller's
// active tenant on it. This is the runtime half of the tenant_isolation row-level
// security policies added in migration 00009: even if a handler's own SQL forgets
// a "where tenant_id = ..." clause, Postgres itself will refuse to read or write
// rows belonging to a different tenant on this connection. It is a backstop, not
// a replacement, for the explicit tenant filtering already present in each query.
func (s *Server) tenantScope(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantID, _ := r.Context().Value(tenantKey).(string)
		if tenantID == "" {
			fail(w, 403, "TENANT_REQUIRED", "No active tenant for this session")
			return
		}
		conn, err := s.db.Acquire(r.Context())
		if err != nil {
			fail(w, 503, "DATABASE_UNAVAILABLE", "Could not reach the database")
			return
		}
		defer conn.Release()
		if _, err := conn.Exec(r.Context(), `select set_config('app.tenant_id', $1, false)`, tenantID); err != nil {
			fail(w, 503, "DATABASE_UNAVAILABLE", "Could not scope the database session")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), connKey, conn)))
	})
}

type user struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Email      string `json:"email"`
	Role       string `json:"role"`
	TenantID   string `json:"tenant_id"`
	Portal     string `json:"portal"`
	TenantName string `json:"tenant_name,omitempty"`
	TenantSlug string `json:"tenant_slug,omitempty"`
	BaseDomain string `json:"base_domain,omitempty"`
	BrandName  string `json:"brand_name,omitempty"`
}

var tenantSlugPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`)
var reservedTenantSlugs = map[string]bool{"admin": true, "api": true, "app": true, "auth": true, "global": true, "www": true}

func New(db *pgxpool.Pool, log *slog.Logger, secure bool) http.Handler {
	s := &Server{db: db, log: log, secure: secure, baseDomain: canonicalHostname(os.Getenv("APP_BASE_DOMAIN"))}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, s.securityHeaders, s.requestLog)
	r.Get("/health", s.health)
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/portal", s.portalInfo)
		r.Get("/portal/logo", s.portalAsset("logo"))
		r.Get("/portal/favicon", s.portalAsset("favicon"))
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)
		r.Group(func(r chi.Router) {
			r.Use(s.authenticate)
			r.Get("/auth/me", s.me)
			r.Get("/tenants", s.listTenants)
			r.Post("/tenants", s.superAdminGlobalRequired(s.createTenant))
			r.Put("/tenants/{id}", s.superAdminGlobalRequired(s.updateTenant))
			r.Post("/tenants/{id}/switch", s.superAdminGlobalRequired(s.switchTenant))
			r.Put("/tenants/{id}/branding", s.superAdminGlobalRequired(s.updateTenantBranding))
			r.Get("/tenants/{id}/branding/{asset}", s.superAdminGlobalRequired(s.tenantBrandingAsset))
			r.Delete("/tenants/{id}/branding/{asset}", s.superAdminGlobalRequired(s.deleteTenantBrandingAsset))
			r.Post("/auth/change-password", s.changePassword)
			r.Get("/users", s.userManagementRequired(s.listUsers))
			r.Post("/users", s.userManagementRequired(s.createUser))
			r.Put("/users/{id}", s.userManagementRequired(s.updateUser))
			r.Delete("/users/{id}", s.userManagementRequired(s.deleteUser))
			// CMDB/infrastructure routes get their own request-scoped, tenant-pinned
			// connection (see tenantScope) so the row-level security policies added in
			// migration 00009 back up the manual "where tenant_id = ..." filtering
			// already present in every one of these handlers.
			r.Group(func(r chi.Router) {
				r.Use(s.tenantScope)
				r.Get("/dashboard", s.dashboard)
				r.Get("/topology", s.topology)
				r.Get("/search", s.search)
				for _, resource := range []string{"sites", "rooms", "racks", "manufacturers", "device-models", "devices", "ports", "connections", "networks", "ip-addresses", "vlans"} {
					res := resource
					r.Get("/"+res, s.list(res))
					r.Post("/"+res, s.writeRequired(s.create(res)))
					r.Get("/"+res+"/{id}", s.get(res))
					r.Put("/"+res+"/{id}", s.writeRequired(s.update(res)))
					r.Delete("/"+res+"/{id}", s.writeRequired(s.remove(res)))
				}
				r.Get("/devices/{id}/ports", s.devicePorts)
				r.Post("/devices/{id}/ports/bulk", s.writeRequired(s.bulkPorts))
				r.Post("/devices/quick-create", s.writeRequired(s.quickCreateDevice))
				r.Get("/networks/{id}/addresses", s.networkAddresses)
			})
		})
	})
	return r
}

type quickPort struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Speed string `json:"speed"`
}

type quickConnection struct {
	PortName         string `json:"port_name"`
	TargetDeviceName string `json:"target_device_name"`
	TargetPortName   string `json:"target_port_name"`
	CableType        string `json:"cable_type"`
	Label            string `json:"label"`
}

type quickDeviceInput struct {
	Name               string            `json:"name"`
	Manufacturer       string            `json:"manufacturer"`
	Model              string            `json:"model"`
	DeviceType         string            `json:"device_type"`
	Purpose            string            `json:"purpose"`
	SiteID             string            `json:"site_id"`
	RackID             string            `json:"rack_id"`
	ManagementIP       string            `json:"management_ip"`
	Status             string            `json:"status"`
	RackPosition       int               `json:"rack_position"`
	RackHeight         int               `json:"rack_height"`
	PowerSupplyCount   int               `json:"power_supply_count"`
	PowerInputVoltage  string            `json:"power_input_voltage"`
	PowerCapacityWatts int               `json:"power_capacity_watts"`
	Ports              []quickPort       `json:"ports"`
	Connections        []quickConnection `json:"connections"`
}

func (s *Server) quickCreateDevice(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Context().Value(tenantKey).(string)
	var in quickDeviceInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&in); err != nil {
		fail(w, 400, "INVALID_JSON", "Invalid request")
		return
	}
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.Manufacturer) == "" || strings.TrimSpace(in.Model) == "" || in.SiteID == "" {
		fail(w, 422, "REQUIRED_FIELDS", "Name, manufacturer, model, and site are required")
		return
	}
	if in.RackHeight < 1 {
		in.RackHeight = 1
	}
	if in.Status == "" {
		in.Status = "active"
	}
	tx, err := s.q(r).Begin(r.Context())
	if err != nil {
		fail(w, 500, "TX_FAILED", "Could not start installation")
		return
	}
	defer tx.Rollback(r.Context())
	var siteAllowed bool
	if err = tx.QueryRow(r.Context(), `select exists(select 1 from sites where id=$1 and tenant_id=$2)`, in.SiteID, tenantID).Scan(&siteAllowed); err != nil || !siteAllowed {
		fail(w, 422, "SITE_NOT_FOUND", "Site is not available in this tenant")
		return
	}
	if in.RackID != "" {
		var rackAllowed bool
		if err = tx.QueryRow(r.Context(), `select exists(select 1 from racks where id=$1 and site_id=$2 and tenant_id=$3)`, in.RackID, in.SiteID, tenantID).Scan(&rackAllowed); err != nil || !rackAllowed {
			fail(w, 422, "RACK_NOT_FOUND", "Rack is not available in this tenant")
			return
		}
	}
	var manufacturerID, modelID, deviceID string
	err = tx.QueryRow(r.Context(), `insert into manufacturers(tenant_id,name) values($1,$2) on conflict(tenant_id,name) do update set name=excluded.name returning id`, tenantID, strings.TrimSpace(in.Manufacturer)).Scan(&manufacturerID)
	if err == nil {
		err = tx.QueryRow(r.Context(), `insert into device_models(tenant_id,manufacturer_id,name,height_u) values($1,$2,$3,$4) on conflict(manufacturer_id,name) do update set height_u=excluded.height_u returning id`, tenantID, manufacturerID, strings.TrimSpace(in.Model), in.RackHeight).Scan(&modelID)
	}
	var rackID any
	var rackPosition any
	if in.RackID != "" {
		rackID, rackPosition = in.RackID, in.RackPosition
	}
	if err == nil {
		err = tx.QueryRow(r.Context(), `insert into devices(tenant_id,name,device_model_id,manufacturer_id,device_type,site_id,rack_id,rack_position,rack_height,management_ip,status,description,power_supply_count,power_input_voltage,power_capacity_watts) values($1,$2,$3,$4,$5,$6,$7,$8,$9,nullif($10,'')::inet,$11,$12,$13,nullif($14,''),nullif($15,0)) returning id`, tenantID, strings.TrimSpace(in.Name), modelID, manufacturerID, in.DeviceType, in.SiteID, rackID, rackPosition, in.RackHeight, in.ManagementIP, in.Status, in.Purpose, in.PowerSupplyCount, in.PowerInputVoltage, in.PowerCapacityWatts).Scan(&deviceID)
	}
	for i := 1; i <= in.PowerSupplyCount; i++ {
		in.Ports = append(in.Ports, quickPort{Name: fmt.Sprintf("PSU%d", i), Type: "power", Speed: in.PowerInputVoltage})
	}
	portIDs := make(map[string]string, len(in.Ports))
	for _, port := range in.Ports {
		if err != nil {
			break
		}
		if port.Type == "" {
			port.Type = "ethernet"
		}
		var id string
		err = tx.QueryRow(r.Context(), `insert into device_ports(tenant_id,device_id,name,type,speed) values($1,$2,$3,$4,nullif($5,'')) returning id`, tenantID, deviceID, strings.TrimSpace(port.Name), port.Type, port.Speed).Scan(&id)
		portIDs[port.Name] = id
	}
	for _, connection := range in.Connections {
		if err != nil || connection.TargetDeviceName == "" || connection.TargetPortName == "" {
			continue
		}
		localID, ok := portIDs[connection.PortName]
		if !ok {
			err = fmt.Errorf("local port %s does not exist", connection.PortName)
			break
		}
		var targetID string
		err = tx.QueryRow(r.Context(), `select p.id from device_ports p join devices d on d.id=p.device_id where d.site_id=$1 and d.tenant_id=$2 and p.tenant_id=$2 and lower(d.name)=lower($3) and lower(p.name)=lower($4)`, in.SiteID, tenantID, connection.TargetDeviceName, connection.TargetPortName).Scan(&targetID)
		if err == nil {
			if connection.CableType == "" {
				connection.CableType = "cat6"
			}
			_, err = tx.Exec(r.Context(), `insert into cables(tenant_id,port_a_id,port_b_id,label,cable_type) values($1,$2,$3,nullif($4,''),$5)`, tenantID, localID, targetID, connection.Label, connection.CableType)
		}
	}
	if err == nil && strings.TrimSpace(in.ManagementIP) != "" {
		var ipID string
		var assignedDevice *string
		lookupErr := tx.QueryRow(r.Context(), `select id,device_id::text from ip_addresses where tenant_id=$1 and address=$2::inet`, tenantID, in.ManagementIP).Scan(&ipID, &assignedDevice)
		switch {
		case lookupErr == nil && assignedDevice != nil && *assignedDevice != deviceID:
			err = fmt.Errorf("IP address is already assigned to another device")
		case lookupErr == nil:
			_, err = tx.Exec(r.Context(), `update ip_addresses set device_id=$1,status='active',updated_at=now() where id=$2`, deviceID, ipID)
		case errors.Is(lookupErr, pgx.ErrNoRows):
			var networkID string
			if err = tx.QueryRow(r.Context(), `select id from networks where tenant_id=$1 and prefix >>= $2::inet order by masklen(prefix) desc limit 1`, tenantID, in.ManagementIP).Scan(&networkID); errors.Is(err, pgx.ErrNoRows) {
				err = fmt.Errorf("IP address does not belong to a documented network; create the network or continue without an IP")
			} else if err == nil {
				err = tx.QueryRow(r.Context(), `insert into ip_addresses(tenant_id,network_id,address,device_id,status,description) values($1,$2,$3::inet,$4,'active','Management address') returning id`, tenantID, networkID, in.ManagementIP, deviceID).Scan(&ipID)
			}
		default:
			err = lookupErr
		}
		if err == nil {
			_, err = tx.Exec(r.Context(), `update devices set management_ip_address_id=$1 where id=$2`, ipID, deviceID)
		}
	}
	if err != nil {
		fail(w, 422, "INSTALLATION_FAILED", err.Error())
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 500, "COMMIT_FAILED", "Could not finish installation")
		return
	}
	respond(w, 201, map[string]any{"data": map[string]any{"id": deviceID, "ports_created": len(in.Ports), "connections_created": len(in.Connections)}})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}
func (s *Server) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		s.log.Info("request completed", "method", r.Method, "path", r.URL.Path, "status", ww.Status(), "duration_ms", time.Since(start).Milliseconds())
	})
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code, msg string) {
	respond(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg}})
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		respond(w, 503, map[string]any{"status": "degraded", "database": "unavailable"})
		return
	}
	respond(w, 200, map[string]any{"status": "ok", "database": "ok"})
}

type portalScope struct {
	Kind            string
	TenantID        string
	TenantName      string
	TenantSlug      string
	BrandName       string
	HasLogo         bool
	HasFavicon      bool
	BrandingVersion int64
}

func canonicalHostname(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	return strings.Trim(strings.TrimSuffix(host, "."), "[]")
}

func matchPortalHost(host, baseDomain string) (kind, slug string, ok bool) {
	host = canonicalHostname(host)
	baseDomain = canonicalHostname(baseDomain)
	if baseDomain == "" {
		return "unscoped", "", true
	}
	if host == baseDomain {
		return "global", "", true
	}
	suffix := "." + baseDomain
	if !strings.HasSuffix(host, suffix) {
		return "", "", false
	}
	slug = strings.TrimSuffix(host, suffix)
	if strings.Contains(slug, ".") || !tenantSlugPattern.MatchString(slug) {
		return "", "", false
	}
	return "tenant", slug, true
}

func (s *Server) resolvePortal(ctx context.Context, host string) (portalScope, error) {
	kind, slug, ok := matchPortalHost(host, s.baseDomain)
	if !ok {
		return portalScope{}, pgx.ErrNoRows
	}
	scope := portalScope{Kind: kind, TenantSlug: slug}
	if kind != "tenant" {
		return scope, nil
	}
	var updatedAt time.Time
	if err := s.db.QueryRow(ctx, `select id,name,coalesce(nullif(brand_name,''),name),logo_data is not null,favicon_data is not null,updated_at from tenants where slug=$1`, slug).Scan(&scope.TenantID, &scope.TenantName, &scope.BrandName, &scope.HasLogo, &scope.HasFavicon, &updatedAt); err != nil {
		return portalScope{}, err
	}
	scope.BrandingVersion = updatedAt.UnixNano()
	return scope, nil
}

func (s *Server) portalURL(slug, requestHost string) string {
	if s.baseDomain == "" {
		return ""
	}
	scheme := "http"
	if s.secure {
		scheme = "https"
	}
	host := slug + "." + s.baseDomain
	// APP_BASE_DOMAIN intentionally stores only the hostname. When Atlas is
	// published on a non-standard port, preserve the port from the validated
	// request host so organization links still point at the running service.
	if _, port, err := net.SplitHostPort(requestHost); err == nil && port != "" {
		host = net.JoinHostPort(host, port)
	}
	return scheme + "://" + host
}

func (s *Server) portalInfo(w http.ResponseWriter, r *http.Request) {
	scope, err := s.resolvePortal(r.Context(), r.Host)
	if err != nil {
		fail(w, 404, "PORTAL_NOT_FOUND", "Organization portal not found")
		return
	}
	data := map[string]any{
		"kind": scope.Kind, "tenant_id": scope.TenantID, "tenant_name": scope.TenantName,
		"tenant_slug": scope.TenantSlug, "base_domain": s.baseDomain, "brand_name": scope.BrandName,
		"has_logo": scope.HasLogo, "has_favicon": scope.HasFavicon, "branding_version": scope.BrandingVersion,
	}
	if scope.Kind == "tenant" {
		if scope.HasLogo {
			data["logo_url"] = fmt.Sprintf("/api/v1/portal/logo?v=%d", scope.BrandingVersion)
		}
		if scope.HasFavicon {
			data["favicon_url"] = fmt.Sprintf("/api/v1/portal/favicon?v=%d", scope.BrandingVersion)
		}
	}
	respond(w, 200, map[string]any{"data": data})
}

func (s *Server) portalAsset(asset string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scope, err := s.resolvePortal(r.Context(), r.Host)
		if err != nil || scope.Kind != "tenant" {
			http.NotFound(w, r)
			return
		}
		s.serveBrandingAsset(w, r, scope.TenantID, asset)
	}
}

func (s *Server) serveBrandingAsset(w http.ResponseWriter, r *http.Request, tenantID, asset string) {
	dataColumn, typeColumn := "logo_data", "logo_content_type"
	if asset == "favicon" {
		dataColumn, typeColumn = "favicon_data", "favicon_content_type"
	} else if asset != "logo" {
		http.NotFound(w, r)
		return
	}
	var data []byte
	var contentType string
	query := fmt.Sprintf("select %s,%s from tenants where id=$1", dataColumn, typeColumn)
	if err := s.db.QueryRow(r.Context(), query, tenantID).Scan(&data, &contentType); err != nil || len(data) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}

func (s *Server) sessionCookie(value string, maxAge int) *http.Cookie {
	cookie := &http.Cookie{Name: "atlas_session", Value: value, Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge}
	if s.baseDomain != "" {
		cookie.Domain = s.baseDomain
	}
	return cookie
}

func (s *Server) clearLegacySessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: "atlas_session", Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	scope, portalErr := s.resolvePortal(r.Context(), r.Host)
	if portalErr != nil {
		fail(w, 404, "PORTAL_NOT_FOUND", "Organization portal not found")
		return
	}
	var in struct{ Email, Password string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in) != nil {
		fail(w, 400, "INVALID_JSON", "Invalid request")
		return
	}
	var u user
	var hash string
	var assignedTenant *string
	err := s.db.QueryRow(r.Context(), "select id,name,email,role::text,password_hash,tenant_id::text from users where lower(email)=lower($1)", in.Email).Scan(&u.ID, &u.Name, &u.Email, &u.Role, &hash, &assignedTenant)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		fail(w, 401, "INVALID_CREDENTIALS", "Invalid email or password")
		return
	}
	if scope.Kind == "global" && u.Role != "master" {
		fail(w, 401, "INVALID_CREDENTIALS", "Invalid email or password")
		return
	}
	if scope.Kind == "tenant" && u.Role != "master" && (assignedTenant == nil || *assignedTenant != scope.TenantID) {
		fail(w, 401, "INVALID_CREDENTIALS", "Invalid email or password")
		return
	}
	token := uuid.NewString()
	if scope.Kind == "tenant" {
		u.TenantID = scope.TenantID
		u.TenantName = scope.TenantName
		u.TenantSlug = scope.TenantSlug
		u.BrandName = scope.BrandName
	} else if assignedTenant != nil {
		u.TenantID = *assignedTenant
	} else if err = s.db.QueryRow(r.Context(), `select id from tenants order by created_at limit 1`).Scan(&u.TenantID); err != nil {
		fail(w, 500, "TENANT_REQUIRED", "No tenant is available")
		return
	}
	_, err = s.db.Exec(r.Context(), "insert into sessions(id,user_id,tenant_id,expires_at) values($1,$2,$3,now()+interval '7 days')", token, u.ID, u.TenantID)
	if err != nil {
		fail(w, 500, "SESSION_ERROR", "Could not create session")
		return
	}
	u.Portal = scope.Kind
	u.BaseDomain = s.baseDomain
	if s.baseDomain != "" {
		s.clearLegacySessionCookie(w)
	}
	http.SetCookie(w, s.sessionCookie(token, 604800))
	respond(w, 200, map[string]any{"data": u})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("atlas_session"); err == nil {
		_, _ = s.db.Exec(r.Context(), "delete from sessions where id=$1", c.Value)
	}
	s.clearLegacySessionCookie(w)
	http.SetCookie(w, s.sessionCookie("", -1))
	respond(w, 200, map[string]any{"data": map[string]bool{"ok": true}})
}
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scope, portalErr := s.resolvePortal(r.Context(), r.Host)
		if portalErr != nil {
			fail(w, 404, "PORTAL_NOT_FOUND", "Organization portal not found")
			return
		}
		c, err := r.Cookie("atlas_session")
		if err != nil {
			fail(w, 401, "UNAUTHENTICATED", "Authentication required")
			return
		}
		var u user
		var assignedTenant *string
		err = s.db.QueryRow(r.Context(), `select u.id,u.name,u.email,u.role::text,s.tenant_id::text,u.tenant_id::text from sessions s join users u on u.id=s.user_id where s.id=$1 and s.expires_at>now()`, c.Value).Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.TenantID, &assignedTenant)
		if err != nil {
			fail(w, 401, "UNAUTHENTICATED", "Session expired")
			return
		}
		if u.Role != "master" && (assignedTenant == nil || *assignedTenant != u.TenantID) {
			fail(w, 403, "TENANT_FORBIDDEN", "Tenant access denied")
			return
		}
		if scope.Kind == "global" && u.Role != "master" {
			fail(w, 403, "GLOBAL_PORTAL_REQUIRED", "Use your organization portal")
			return
		}
		if scope.Kind == "tenant" && u.TenantID != scope.TenantID {
			fail(w, 403, "TENANT_FORBIDDEN", "Tenant access denied")
			return
		}
		u.Portal = scope.Kind
		u.BaseDomain = s.baseDomain
		if scope.Kind == "tenant" {
			u.TenantName = scope.TenantName
			u.TenantSlug = scope.TenantSlug
			u.BrandName = scope.BrandName
		}
		ctx := context.WithValue(r.Context(), userKey, u)
		ctx = context.WithValue(ctx, tenantKey, u.TenantID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, map[string]any{"data": r.Context().Value(userKey)})
}
func (s *Server) listTenants(w http.ResponseWriter, r *http.Request) {
	u := r.Context().Value(userKey).(user)
	query := `select t.id,t.name,t.slug,t.created_at,t.updated_at,coalesce(t.brand_name,''),t.logo_data is not null,t.favicon_data is not null,
		(select count(*) from sites s where s.tenant_id=t.id),
		(select count(*) from devices d where d.tenant_id=t.id),
		(select count(*) from users x where x.tenant_id=t.id)
		from tenants t where t.id=$1 order by t.name`
	args := []any{u.TenantID}
	if u.Role == "master" && u.Portal != "tenant" {
		query = `select t.id,t.name,t.slug,t.created_at,t.updated_at,coalesce(t.brand_name,''),t.logo_data is not null,t.favicon_data is not null,
			(select count(*) from sites s where s.tenant_id=t.id),
			(select count(*) from devices d where d.tenant_id=t.id),
			(select count(*) from users x where x.tenant_id=t.id)
			from tenants t order by t.name`
		args = nil
	}
	rows, err := s.db.Query(r.Context(), query, args...)
	if err != nil {
		fail(w, 500, "QUERY_FAILED", "Could not list tenants")
		return
	}
	defer rows.Close()
	type item struct {
		ID         string    `json:"id"`
		Name       string    `json:"name"`
		Slug       string    `json:"slug"`
		CreatedAt  time.Time `json:"created_at"`
		UpdatedAt  time.Time `json:"updated_at"`
		BrandName  string    `json:"brand_name"`
		HasLogo    bool      `json:"has_logo"`
		HasFavicon bool      `json:"has_favicon"`
		Sites      int64     `json:"sites"`
		Devices    int64     `json:"devices"`
		Users      int64     `json:"users"`
		URL        string    `json:"url"`
		LogoURL    string    `json:"logo_url,omitempty"`
		FaviconURL string    `json:"favicon_url,omitempty"`
	}
	data := []item{}
	for rows.Next() {
		var v item
		if err := rows.Scan(&v.ID, &v.Name, &v.Slug, &v.CreatedAt, &v.UpdatedAt, &v.BrandName, &v.HasLogo, &v.HasFavicon, &v.Sites, &v.Devices, &v.Users); err != nil {
			fail(w, 500, "SCAN_FAILED", "Could not read tenants")
			return
		}
		v.URL = s.portalURL(v.Slug, r.Host)
		if v.HasLogo {
			v.LogoURL = fmt.Sprintf("/api/v1/tenants/%s/branding/logo?v=%d", v.ID, v.UpdatedAt.UnixNano())
		}
		if v.HasFavicon {
			v.FaviconURL = fmt.Sprintf("/api/v1/tenants/%s/branding/favicon?v=%d", v.ID, v.UpdatedAt.UnixNano())
		}
		data = append(data, v)
	}
	respond(w, 200, map[string]any{"data": data})
}
func (s *Server) updateTenant(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in) != nil {
		fail(w, 400, "INVALID_JSON", "Invalid request")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Slug = strings.ToLower(strings.TrimSpace(in.Slug))
	if in.Name == "" || !tenantSlugPattern.MatchString(in.Slug) || reservedTenantSlugs[in.Slug] {
		fail(w, 422, "INVALID_TENANT", "Name and a valid slug are required")
		return
	}
	id := chi.URLParam(r, "id")
	var exists bool
	if err := s.db.QueryRow(r.Context(), `select exists(select 1 from tenants where id=$1)`, id).Scan(&exists); err != nil {
		fail(w, 500, "QUERY_FAILED", "Could not read organization")
		return
	} else if !exists {
		fail(w, 404, "TENANT_NOT_FOUND", "Organization not found")
		return
	}
	if _, err := s.db.Exec(r.Context(), `update tenants set name=$1,slug=$2,updated_at=now() where id=$3`, in.Name, in.Slug, id); err != nil {
		fail(w, 422, "TENANT_UPDATE_FAILED", "Could not update organization")
		return
	}
	respond(w, 200, map[string]any{"data": map[string]string{"id": id}})
}

func readBrandImage(file multipart.File, maxBytes int64, favicon bool) ([]byte, string, error) {
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) == 0 || int64(len(data)) > maxBytes {
		return nil, "", fmt.Errorf("image exceeds the allowed size")
	}
	contentType := http.DetectContentType(data)
	allowed := contentType == "image/png" || contentType == "image/jpeg" || contentType == "image/webp"
	if favicon {
		allowed = allowed || contentType == "image/x-icon" || contentType == "image/vnd.microsoft.icon"
	}
	if !allowed {
		return nil, "", fmt.Errorf("unsupported image type")
	}
	return data, contentType, nil
}

func (s *Server) updateTenantBranding(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 3<<20)
	if err := r.ParseMultipartForm(3 << 20); err != nil {
		fail(w, 422, "INVALID_BRANDING", "Branding form is too large or invalid")
		return
	}
	brandName := strings.TrimSpace(r.FormValue("brand_name"))
	if len(brandName) > 80 {
		fail(w, 422, "INVALID_BRAND_NAME", "Brand name must have at most 80 characters")
		return
	}
	var logoData, faviconData []byte
	var logoType, faviconType string
	logoProvided, faviconProvided := false, false
	if file, _, err := r.FormFile("logo"); err == nil {
		logoProvided = true
		defer file.Close()
		if logoData, logoType, err = readBrandImage(file, 2<<20, false); err != nil {
			fail(w, 422, "INVALID_LOGO", "Logo must be a PNG, JPEG, or WebP image up to 2 MB")
			return
		}
	} else if !errors.Is(err, http.ErrMissingFile) {
		fail(w, 422, "INVALID_LOGO", "Could not read logo")
		return
	}
	if file, _, err := r.FormFile("favicon"); err == nil {
		faviconProvided = true
		defer file.Close()
		if faviconData, faviconType, err = readBrandImage(file, 256<<10, true); err != nil {
			fail(w, 422, "INVALID_FAVICON", "Favicon must be a PNG, ICO, JPEG, or WebP image up to 256 KB")
			return
		}
	} else if !errors.Is(err, http.ErrMissingFile) {
		fail(w, 422, "INVALID_FAVICON", "Could not read favicon")
		return
	}
	id := chi.URLParam(r, "id")
	tag, err := s.db.Exec(r.Context(), `update tenants set brand_name=nullif($1,''),
		logo_data=case when $2 then $3 else logo_data end,
		logo_content_type=case when $2 then $4 else logo_content_type end,
		favicon_data=case when $5 then $6 else favicon_data end,
		favicon_content_type=case when $5 then $7 else favicon_content_type end,
		updated_at=now() where id=$8`, brandName, logoProvided, logoData, logoType, faviconProvided, faviconData, faviconType, id)
	if err != nil {
		fail(w, 422, "BRANDING_UPDATE_FAILED", "Could not update organization branding")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "TENANT_NOT_FOUND", "Organization not found")
		return
	}
	respond(w, 200, map[string]any{"data": map[string]any{"id": id, "logo_updated": logoProvided, "favicon_updated": faviconProvided}})
}

func (s *Server) deleteTenantBrandingAsset(w http.ResponseWriter, r *http.Request) {
	asset := chi.URLParam(r, "asset")
	columnData, columnType := "logo_data", "logo_content_type"
	if asset == "favicon" {
		columnData, columnType = "favicon_data", "favicon_content_type"
	} else if asset != "logo" {
		fail(w, 404, "ASSET_NOT_FOUND", "Branding asset not found")
		return
	}
	query := fmt.Sprintf("update tenants set %s=null,%s=null,updated_at=now() where id=$1", columnData, columnType)
	tag, err := s.db.Exec(r.Context(), query, chi.URLParam(r, "id"))
	if err != nil {
		fail(w, 500, "BRANDING_DELETE_FAILED", "Could not remove branding asset")
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "TENANT_NOT_FOUND", "Organization not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) tenantBrandingAsset(w http.ResponseWriter, r *http.Request) {
	s.serveBrandingAsset(w, r, chi.URLParam(r, "id"), chi.URLParam(r, "asset"))
}

func (s *Server) createTenant(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in) != nil {
		fail(w, 400, "INVALID_JSON", "Invalid request")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Slug = strings.ToLower(strings.TrimSpace(in.Slug))
	if in.Name == "" || !tenantSlugPattern.MatchString(in.Slug) || reservedTenantSlugs[in.Slug] {
		fail(w, 422, "INVALID_TENANT", "Name and a valid slug are required")
		return
	}
	var id string
	if err := s.db.QueryRow(r.Context(), `insert into tenants(name,slug) values($1,$2) returning id`, in.Name, in.Slug).Scan(&id); err != nil {
		fail(w, 422, "TENANT_CREATE_FAILED", err.Error())
		return
	}
	respond(w, 201, map[string]any{"data": map[string]string{"id": id}})
}
func (s *Server) switchTenant(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var exists bool
	if err := s.db.QueryRow(r.Context(), `select exists(select 1 from tenants where id=$1)`, id).Scan(&exists); err != nil || !exists {
		fail(w, 404, "TENANT_NOT_FOUND", "Tenant not found")
		return
	}
	cookie, err := r.Cookie("atlas_session")
	if err != nil {
		fail(w, 401, "UNAUTHENTICATED", "Authentication required")
		return
	}
	if _, err = s.db.Exec(r.Context(), `update sessions set tenant_id=$1 where id=$2`, id, cookie.Value); err != nil {
		fail(w, 500, "TENANT_SWITCH_FAILED", "Could not switch tenant")
		return
	}
	if s.baseDomain != "" {
		s.clearLegacySessionCookie(w)
		http.SetCookie(w, s.sessionCookie(cookie.Value, 604800))
	}
	respond(w, 200, map[string]any{"data": map[string]string{"tenant_id": id}})
}
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in) != nil {
		fail(w, 400, "INVALID_JSON", "Invalid request")
		return
	}
	if len(in.NewPassword) < 12 {
		fail(w, 422, "WEAK_PASSWORD", "New password must have at least 12 characters")
		return
	}
	u := r.Context().Value(userKey).(user)
	var currentHash string
	if err := s.db.QueryRow(r.Context(), `select password_hash from users where id=$1`, u.ID).Scan(&currentHash); err != nil || bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(in.CurrentPassword)) != nil {
		fail(w, 401, "INVALID_CURRENT_PASSWORD", "Current password is incorrect")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(in.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, "PASSWORD_ERROR", "Could not secure password")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		fail(w, 500, "TX_FAILED", "Could not change password")
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), `update users set password_hash=$1,updated_at=now() where id=$2`, string(newHash), u.ID); err == nil {
		if cookie, cookieErr := r.Cookie("atlas_session"); cookieErr == nil {
			_, err = tx.Exec(r.Context(), `delete from sessions where user_id=$1 and id<>$2`, u.ID, cookie.Value)
		} else {
			_, err = tx.Exec(r.Context(), `delete from sessions where user_id=$1`, u.ID)
		}
	}
	if err != nil {
		fail(w, 500, "PASSWORD_CHANGE_FAILED", "Could not change password")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 500, "COMMIT_FAILED", "Could not change password")
		return
	}
	respond(w, 200, map[string]any{"data": map[string]bool{"ok": true}})
}
func (s *Server) writeRequired(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := r.Context().Value(userKey).(user)
		if u.Role != "master" && u.Role != "superadmin" && u.Role != "admin" && u.Role != "editor" {
			fail(w, 403, "FORBIDDEN", "Read-only role")
			return
		}
		next(w, r)
	}
}

func (s *Server) superAdminRequired(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Context().Value(userKey).(user).Role != "master" {
			fail(w, 403, "SUPERADMIN_REQUIRED", "Superadministrator access required")
			return
		}
		next(w, r)
	}
}

func (s *Server) superAdminGlobalRequired(next http.HandlerFunc) http.HandlerFunc {
	return s.superAdminRequired(func(w http.ResponseWriter, r *http.Request) {
		if r.Context().Value(userKey).(user).Portal == "tenant" {
			fail(w, 403, "GLOBAL_PORTAL_REQUIRED", "Use the global superadministrator portal")
			return
		}
		next(w, r)
	})
}

// userManagementRequired lets a tenant's own admin manage that tenant's users
// (previously only a global superadmin could touch /users at all), in
// addition to superadmins. Handlers behind it still scope every query to the
// caller's tenant via tenantKey, and separately guard against a tenant admin
// creating, editing, or deleting a superadmin account.
func (s *Server) userManagementRequired(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := r.Context().Value(userKey).(user).Role
		if role != "master" && role != "superadmin" && role != "admin" {
			fail(w, 403, "ADMIN_REQUIRED", "Administrator access required")
			return
		}
		next(w, r)
	}
}

func validUserRole(role string) bool {
	return role == "superadmin" || role == "admin" || role == "editor" || role == "viewer"
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Context().Value(tenantKey).(string)
	query := `select id,name,email,role::text,created_at,updated_at from users where tenant_id=$1 order by name`
	rows, err := s.db.Query(r.Context(), query, tenantID)
	if err != nil {
		fail(w, 500, "QUERY_FAILED", "Could not list users")
		return
	}
	defer rows.Close()
	type item struct {
		ID        string    `json:"id"`
		Name      string    `json:"name"`
		Email     string    `json:"email"`
		Role      string    `json:"role"`
		CreatedAt time.Time `json:"created_at"`
		UpdatedAt time.Time `json:"updated_at"`
	}
	data := []item{}
	for rows.Next() {
		var v item
		if err := rows.Scan(&v.ID, &v.Name, &v.Email, &v.Role, &v.CreatedAt, &v.UpdatedAt); err != nil {
			fail(w, 500, "SCAN_FAILED", "Could not read users")
			return
		}
		data = append(data, v)
	}
	respond(w, 200, map[string]any{"data": data})
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in) != nil {
		fail(w, 400, "INVALID_JSON", "Invalid request")
		return
	}
	if strings.TrimSpace(in.Name) == "" || !strings.Contains(in.Email, "@") || len(in.Password) < 12 || !validUserRole(in.Role) {
		fail(w, 422, "INVALID_USER", "Name, valid email, role, and a 12-character password are required")
		return
	}
	callerRole := r.Context().Value(userKey).(user).Role
	if in.Role == "superadmin" && callerRole != "master" && callerRole != "superadmin" {
		fail(w, 403, "SUPERADMIN_REQUIRED", "Only a superadministrator can grant that role")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		fail(w, 500, "PASSWORD_ERROR", "Could not secure password")
		return
	}
	var id string
	var tenantID any = r.Context().Value(tenantKey).(string)
	err = s.db.QueryRow(r.Context(), `insert into users(name,email,password_hash,role,tenant_id) values($1,lower($2),$3,$4,$5) returning id`, strings.TrimSpace(in.Name), strings.TrimSpace(in.Email), string(hash), in.Role, tenantID).Scan(&id)
	if err != nil {
		fail(w, 422, "USER_CREATE_FAILED", err.Error())
		return
	}
	respond(w, 201, map[string]any{"data": map[string]string{"id": id}})
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var in struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in) != nil {
		fail(w, 400, "INVALID_JSON", "Invalid request")
		return
	}
	if strings.TrimSpace(in.Name) == "" || !strings.Contains(in.Email, "@") || !validUserRole(in.Role) {
		fail(w, 422, "INVALID_USER", "Name, valid email, and role are required")
		return
	}
	caller := r.Context().Value(userKey).(user)
	if in.Role == "superadmin" && caller.Role != "master" && caller.Role != "superadmin" {
		fail(w, 403, "SUPERADMIN_REQUIRED", "Only a superadministrator can grant that role")
		return
	}
	var currentRole string
	if err := s.db.QueryRow(r.Context(), `select role::text from users where id=$1 and tenant_id=$2`, id, r.Context().Value(tenantKey).(string)).Scan(&currentRole); errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "USER_NOT_FOUND", "User not found")
		return
	} else if err != nil {
		fail(w, 500, "QUERY_FAILED", "Could not read user")
		return
	}
	if currentRole == "superadmin" && caller.Role != "master" && caller.Role != "superadmin" {
		fail(w, 403, "SUPERADMIN_REQUIRED", "Only a superadministrator can modify a superadministrator")
		return
	}
	if currentRole == "superadmin" && in.Role != "superadmin" {
		var count int
		_ = s.db.QueryRow(r.Context(), `select count(*) from users where role='superadmin' and tenant_id=$1`, r.Context().Value(tenantKey).(string)).Scan(&count)
		if count <= 1 {
			fail(w, 409, "LAST_SUPERADMIN", "The last superadministrator cannot be demoted")
			return
		}
	}
	var newTenant any = r.Context().Value(tenantKey).(string)
	if in.Password != "" {
		if len(in.Password) < 12 {
			fail(w, 422, "WEAK_PASSWORD", "Password must have at least 12 characters")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		if err != nil {
			fail(w, 500, "PASSWORD_ERROR", "Could not secure password")
			return
		}
		_, err = s.db.Exec(r.Context(), `update users set name=$1,email=lower($2),role=$3,password_hash=$4,tenant_id=$5,updated_at=now() where id=$6`, strings.TrimSpace(in.Name), strings.TrimSpace(in.Email), in.Role, string(hash), newTenant, id)
		if err != nil {
			fail(w, 422, "USER_UPDATE_FAILED", err.Error())
			return
		}
		_, _ = s.db.Exec(r.Context(), `delete from sessions where user_id=$1`, id)
	} else {
		if _, err := s.db.Exec(r.Context(), `update users set name=$1,email=lower($2),role=$3,tenant_id=$4,updated_at=now() where id=$5`, strings.TrimSpace(in.Name), strings.TrimSpace(in.Email), in.Role, newTenant, id); err != nil {
			fail(w, 422, "USER_UPDATE_FAILED", err.Error())
			return
		}
	}
	respond(w, 200, map[string]any{"data": map[string]string{"id": id}})
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	current := r.Context().Value(userKey).(user)
	if id == current.ID {
		fail(w, 409, "CANNOT_DELETE_SELF", "You cannot delete your own account")
		return
	}
	var role string
	if err := s.db.QueryRow(r.Context(), `select role::text from users where id=$1 and tenant_id=$2`, id, r.Context().Value(tenantKey).(string)).Scan(&role); errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "USER_NOT_FOUND", "User not found")
		return
	} else if err != nil {
		fail(w, 500, "QUERY_FAILED", "Could not read user")
		return
	}
	if role == "superadmin" {
		if current.Role != "master" && current.Role != "superadmin" {
			fail(w, 403, "SUPERADMIN_REQUIRED", "Only a superadministrator can delete a superadministrator")
			return
		}
		var count int
		_ = s.db.QueryRow(r.Context(), `select count(*) from users where role='superadmin' and tenant_id=$1`, r.Context().Value(tenantKey).(string)).Scan(&count)
		if count <= 1 {
			fail(w, 409, "LAST_SUPERADMIN", "The last superadministrator cannot be deleted")
			return
		}
	}
	if _, err := s.db.Exec(r.Context(), `delete from users where id=$1`, id); err != nil {
		fail(w, 409, "USER_DELETE_FAILED", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var tables = map[string]string{"sites": "sites", "rooms": "rooms", "racks": "racks", "manufacturers": "manufacturers", "device-models": "device_models", "devices": "devices", "ports": "device_ports", "connections": "cables", "networks": "networks", "ip-addresses": "ip_addresses", "vlans": "vlans"}

// inetColumns lists the inet-typed columns reachable through the generic
// create/update handlers. Postgres rejects an empty string cast to inet, so a
// bare "management_ip":"" from a client (the natural way to say "clear this
// field") would otherwise fail with a 422 instead of nulling the column out.
var inetColumns = map[string]bool{"management_ip": true, "gateway": true}

func (s *Server) list(resource string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		table := tables[resource]
		size, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
		if size < 1 || size > 100 {
			size = 50
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		tenantID := r.Context().Value(tenantKey).(string)
		var total int
		if err := s.q(r).QueryRow(r.Context(), fmt.Sprintf("select count(*) from %s where tenant_id=$1", table), tenantID).Scan(&total); err != nil {
			fail(w, 500, "QUERY_FAILED", err.Error())
			return
		}
		q := fmt.Sprintf("select row_to_json(t) from (select * from %s where tenant_id=$1 order by created_at desc limit $2 offset $3) t", table)
		rows, err := s.q(r).Query(r.Context(), q, tenantID, size, (page-1)*size)
		if err != nil {
			fail(w, 500, "QUERY_FAILED", err.Error())
			return
		}
		defer rows.Close()
		data := []json.RawMessage{}
		for rows.Next() {
			var v json.RawMessage
			_ = rows.Scan(&v)
			data = append(data, v)
		}
		respond(w, 200, map[string]any{"data": data, "meta": map[string]int{"page": page, "page_size": size, "total": total}})
	}
}
func (s *Server) get(resource string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := fmt.Sprintf("select row_to_json(t) from (select * from %s where id=$1 and tenant_id=$2) t", tables[resource])
		var v json.RawMessage
		if err := s.q(r).QueryRow(r.Context(), q, chi.URLParam(r, "id"), r.Context().Value(tenantKey).(string)).Scan(&v); errors.Is(err, pgx.ErrNoRows) {
			fail(w, 404, "NOT_FOUND", strings.TrimSuffix(strings.ToUpper(resource), "S")+" not found")
			return
		} else if err != nil {
			fail(w, 500, "QUERY_FAILED", err.Error())
			return
		}
		respond(w, 200, map[string]any{"data": v})
	}
}
func decodeMap(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var in map[string]any
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in) != nil {
		fail(w, 400, "INVALID_JSON", "Invalid request")
		return nil, false
	}
	delete(in, "id")
	delete(in, "created_at")
	delete(in, "updated_at")
	return in, true
}

func safeColumn(name string) bool {
	if name == "" {
		return false
	}
	for _, char := range name {
		if (char < 'a' || char > 'z') && char != '_' {
			return false
		}
	}
	return true
}
func (s *Server) create(resource string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		in, ok := decodeMap(w, r)
		if !ok {
			return
		}
		delete(in, "tenant_id")
		cols := []string{"tenant_id"}
		vals := []any{r.Context().Value(tenantKey).(string)}
		marks := []string{"$1"}
		i := 2
		for k, v := range in {
			if !safeColumn(k) {
				fail(w, 400, "INVALID_FIELD", "Invalid field name")
				return
			}
			cols = append(cols, k)
			vals = append(vals, v)
			marks = append(marks, fmt.Sprintf("$%d", i))
			i++
		}
		if len(cols) == 1 {
			fail(w, 400, "EMPTY_REQUEST", "At least one field is required")
			return
		}
		q := fmt.Sprintf("insert into %s(%s) values(%s) returning id", tables[resource], strings.Join(cols, ","), strings.Join(marks, ","))
		var id string
		if err := s.q(r).QueryRow(r.Context(), q, vals...).Scan(&id); err != nil {
			fail(w, 422, "VALIDATION_FAILED", err.Error())
			return
		}
		respond(w, 201, map[string]any{"data": map[string]string{"id": id}})
	}
}
func (s *Server) update(resource string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		in, ok := decodeMap(w, r)
		if !ok {
			return
		}
		delete(in, "tenant_id")
		sets := []string{}
		vals := []any{}
		i := 1
		for k, v := range in {
			if !safeColumn(k) {
				fail(w, 400, "INVALID_FIELD", "Invalid field name")
				return
			}
			// inet columns (management_ip, gateway) reject an empty-string bind
			// with a Postgres cast error. The frontend sends "" to mean "clear
			// this field", so translate that to a real SQL NULL here — a nil
			// bind is valid for any column type, including inet.
			if inetColumns[k] {
				if sv, ok := v.(string); ok && sv == "" {
					v = nil
				}
			}
			sets = append(sets, fmt.Sprintf("%s=$%d", k, i))
			vals = append(vals, v)
			i++
		}
		if len(sets) == 0 {
			fail(w, 400, "EMPTY_REQUEST", "At least one field is required")
			return
		}
		vals = append(vals, chi.URLParam(r, "id"), r.Context().Value(tenantKey).(string))
		q := fmt.Sprintf("update %s set %s,updated_at=now() where id=$%d and tenant_id=$%d", tables[resource], strings.Join(sets, ","), i, i+1)
		tag, err := s.q(r).Exec(r.Context(), q, vals...)
		if err != nil {
			fail(w, 422, "VALIDATION_FAILED", err.Error())
			return
		}
		if tag.RowsAffected() == 0 {
			fail(w, 404, "NOT_FOUND", "Record not found")
			return
		}
		respond(w, 200, map[string]any{"data": map[string]string{"id": chi.URLParam(r, "id")}})
	}
}
func (s *Server) remove(resource string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tag, err := s.q(r).Exec(r.Context(), fmt.Sprintf("delete from %s where id=$1 and tenant_id=$2", tables[resource]), chi.URLParam(r, "id"), r.Context().Value(tenantKey).(string))
		if err != nil {
			fail(w, 409, "DELETE_FAILED", err.Error())
			return
		}
		if tag.RowsAffected() == 0 {
			fail(w, 404, "NOT_FOUND", "Record not found")
			return
		}
		w.WriteHeader(204)
	}
}
func (s *Server) devicePorts(w http.ResponseWriter, r *http.Request) {
	rows, err := s.q(r).Query(r.Context(), "select row_to_json(p) from device_ports p where device_id=$1 and tenant_id=$2 order by name", chi.URLParam(r, "id"), r.Context().Value(tenantKey).(string))
	if err != nil {
		fail(w, 500, "QUERY_FAILED", err.Error())
		return
	}
	defer rows.Close()
	var data []json.RawMessage
	for rows.Next() {
		var v json.RawMessage
		_ = rows.Scan(&v)
		data = append(data, v)
	}
	respond(w, 200, map[string]any{"data": data})
}
func (s *Server) bulkPorts(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Prefix, Type string
		Start, End   int
	}
	if json.NewDecoder(r.Body).Decode(&in) != nil || in.Start < 1 || in.End < in.Start || in.End-in.Start > 255 {
		fail(w, 400, "INVALID_RANGE", "Invalid port range")
		return
	}
	tx, err := s.q(r).Begin(r.Context())
	if err != nil {
		fail(w, 500, "TX_FAILED", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	tenantID := r.Context().Value(tenantKey).(string)
	var allowed bool
	if err = tx.QueryRow(r.Context(), `select exists(select 1 from devices where id=$1 and tenant_id=$2)`, chi.URLParam(r, "id"), tenantID).Scan(&allowed); err != nil || !allowed {
		fail(w, 404, "DEVICE_NOT_FOUND", "Device not found")
		return
	}
	for i := in.Start; i <= in.End; i++ {
		_, err = tx.Exec(r.Context(), "insert into device_ports(tenant_id,device_id,name,type) values($1,$2,$3,$4)", tenantID, chi.URLParam(r, "id"), fmt.Sprintf("%s%d", in.Prefix, i), in.Type)
		if err != nil {
			fail(w, 422, "PORT_CREATE_FAILED", err.Error())
			return
		}
	}
	_ = tx.Commit(r.Context())
	respond(w, 201, map[string]any{"data": map[string]int{"created": in.End - in.Start + 1}})
}

// maxNetworkAddresses caps how large a prefix networkAddresses will expand
// into individual rows (a /20 IPv4 network), so a mistakenly huge prefix
// (e.g. /8) can't generate millions of rows in one response.
const maxNetworkAddresses = 4096

type networkAddress struct {
	Address      string `json:"address"`
	ID           string `json:"id,omitempty"`
	DeviceID     string `json:"device_id,omitempty"`
	DeviceName   string `json:"device_name,omitempty"`
	DeviceType   string `json:"device_type,omitempty"`
	AssignedTo   string `json:"assigned_to,omitempty"`
	DNSName      string `json:"dns_name,omitempty"`
	Description  string `json:"description,omitempty"`
	Status       string `json:"status"`
	Special      string `json:"special,omitempty"`
	SubnetID     string `json:"subnet_id,omitempty"`
	SubnetPrefix string `json:"subnet_prefix,omitempty"`
	SubnetName   string `json:"subnet_name,omitempty"`
}

type relatedNetwork struct {
	ID     string `json:"id"`
	Prefix string `json:"prefix"`
	Name   string `json:"name"`
}

// networkAddresses reports every address known about inside a documented
// network's CIDR prefix, left-joined against any ip_addresses row already
// documented for that address.
//
// IPv4 prefixes (up to /20, 4096 addresses) are fully expanded into one row
// per address, so undocumented addresses come back with status "free" and
// the frontend can render a phpIPAM-style grid of the whole space. IPv6
// prefixes are never expanded this way — even a /64 has 2^64 addresses, so
// "list every address" is meaningless there. For IPv6 this instead returns
// only the addresses someone has actually documented, most specific first;
// the UI's job for IPv6 is exact-match lookup and documentation, not a grid
// of free slots.
//
// Networks nest by CIDR containment alone — there is no parent_id column,
// and the containment check works identically for IPv4 and IPv6 since it's
// backed by Postgres's cidr "<<"/">>" operators. Any other documented
// network whose prefix falls inside this one is treated as a subnet of it,
// at any depth. That also means it works retroactively: creating
// 10.0.0.0/21 and 10.0.0.0/27 nests the /27 under the /21 automatically, in
// whichever order they were created. An address handed to a subnet is
// rolled up here too (so the parent's utilization reflects it) and, for
// IPv4, when it has no row of its own, is reported as status "subnet"
// pointing at the most specific subnet that contains it, rather than as
// free space directly assignable at this level.
func (s *Server) networkAddresses(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Context().Value(tenantKey).(string)
	networkID := chi.URLParam(r, "id")
	var prefix string
	if err := s.q(r).QueryRow(r.Context(), `select prefix::text from networks where id=$1 and tenant_id=$2`, networkID, tenantID).Scan(&prefix); errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "NOT_FOUND", "Network not found")
		return
	} else if err != nil {
		fail(w, 500, "QUERY_FAILED", err.Error())
		return
	}
	_, ipnet, err := net.ParseCIDR(prefix)
	if err != nil {
		fail(w, 422, "UNSUPPORTED_PREFIX", "Could not parse this network's prefix")
		return
	}
	isIPv4 := ipnet.IP.To4() != nil
	family := "ipv6"
	var ones int
	var v4Count uint64
	if isIPv4 {
		family = "ipv4"
		ones, _ = ipnet.Mask.Size()
		v4Count = uint64(1) << uint(32-ones)
		if v4Count > maxNetworkAddresses {
			fail(w, 422, "PREFIX_TOO_LARGE", fmt.Sprintf("This prefix has %d addresses, which is too many to list individually (max %d, a /20). Narrow it or split it into smaller networks.", v4Count, maxNetworkAddresses))
			return
		}
	}

	type subnet struct {
		id, prefix, name string
		ipnet            *net.IPNet
	}
	subRows, err := s.q(r).Query(r.Context(), `select id,prefix::text,name from networks where tenant_id=$1 and prefix<<$2::cidr and id<>$3 order by masklen(prefix) desc`, tenantID, prefix, networkID)
	if err != nil {
		fail(w, 500, "QUERY_FAILED", err.Error())
		return
	}
	var subnets []subnet
	subnetIDs := []string{networkID}
	for subRows.Next() {
		var sn subnet
		if err := subRows.Scan(&sn.id, &sn.prefix, &sn.name); err != nil {
			subRows.Close()
			fail(w, 500, "QUERY_FAILED", err.Error())
			return
		}
		if _, sub, err := net.ParseCIDR(sn.prefix); err == nil && (sub.IP.To4() != nil) == isIPv4 {
			sn.ipnet = sub
			subnets = append(subnets, sn)
			subnetIDs = append(subnetIDs, sn.id)
		}
	}
	subRows.Close()

	var parent *relatedNetwork
	var p relatedNetwork
	if err := s.q(r).QueryRow(r.Context(), `select id,prefix::text,name from networks where tenant_id=$1 and prefix>>$2::cidr and id<>$3 order by masklen(prefix) desc limit 1`, tenantID, prefix, networkID).Scan(&p.ID, &p.Prefix, &p.Name); err == nil {
		parent = &p
	} else if !errors.Is(err, pgx.ErrNoRows) {
		fail(w, 500, "QUERY_FAILED", err.Error())
		return
	}

	// host(ip.address), not ip.address::text: casting an inet to text keeps its
	// netmask (e.g. "192.168.0.10/32"), which would never match the bare
	// address strings this handler compares below. network_id=any($2) pulls
	// in addresses documented directly on this network AND on any subnet
	// nested inside it, so a device attached inside a /27 (or a ::/112, for
	// IPv6) shows up when viewing the containing network. "order by
	// ip.address" gives IPv6's non-enumerated path a sensible numeric order
	// for free.
	rows, err := s.q(r).Query(r.Context(), `select host(ip.address),ip.id,coalesce(ip.device_id::text,''),coalesce(d.name,''),coalesce(d.device_type,''),coalesce(ip.assigned_to,''),coalesce(ip.dns_name,''),coalesce(ip.description,''),ip.status,coalesce(ip.network_id::text,'') from ip_addresses ip left join devices d on d.id=ip.device_id and d.tenant_id=ip.tenant_id where ip.tenant_id=$1 and ip.network_id=any($2::uuid[]) order by ip.address`, tenantID, subnetIDs)
	if err != nil {
		fail(w, 500, "QUERY_FAILED", err.Error())
		return
	}
	defer rows.Close()
	existing := map[string]networkAddress{}
	documented := []networkAddress{}
	for rows.Next() {
		var a networkAddress
		var rowNetworkID string
		if err := rows.Scan(&a.Address, &a.ID, &a.DeviceID, &a.DeviceName, &a.DeviceType, &a.AssignedTo, &a.DNSName, &a.Description, &a.Status, &rowNetworkID); err != nil {
			fail(w, 500, "QUERY_FAILED", err.Error())
			return
		}
		for _, sn := range subnets {
			if sn.id == rowNetworkID {
				a.SubnetID, a.SubnetPrefix, a.SubnetName = sn.id, sn.prefix, sn.name
				break
			}
		}
		existing[a.Address] = a
		documented = append(documented, a)
	}

	var result []networkAddress
	total := len(documented)
	if isIPv4 {
		base := binary.BigEndian.Uint32(ipnet.IP.To4())
		result = make([]networkAddress, 0, v4Count)
		for i := uint32(0); uint64(i) < v4Count; i++ {
			b := make([]byte, 4)
			binary.BigEndian.PutUint32(b, base+i)
			addr := net.IP(b).String()
			if row, ok := existing[addr]; ok {
				result = append(result, row)
				continue
			}
			entry := networkAddress{Address: addr, Status: "free"}
			if ones < 31 {
				if i == 0 {
					entry.Special = "network"
				} else if uint64(i) == v4Count-1 {
					entry.Special = "broadcast"
				}
			}
			// subnets is sorted most-specific-first, so the first containment
			// match is the tightest subnet this address was delegated to.
			if ip := net.ParseIP(addr); ip != nil {
				for _, sn := range subnets {
					if sn.ipnet.Contains(ip) {
						entry.Status = "subnet"
						entry.SubnetID, entry.SubnetPrefix, entry.SubnetName = sn.id, sn.prefix, sn.name
						break
					}
				}
			}
			result = append(result, entry)
		}
		total = int(v4Count)
	} else {
		result = documented
	}
	subnetList := make([]relatedNetwork, len(subnets))
	for i, sn := range subnets {
		subnetList[i] = relatedNetwork{ID: sn.id, Prefix: sn.prefix, Name: sn.name}
	}
	respond(w, 200, map[string]any{"data": result, "meta": map[string]any{"prefix": prefix, "family": family, "total": total, "parent": parent, "subnets": subnetList}})
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	var v json.RawMessage
	err := s.q(r).QueryRow(r.Context(), `select json_build_object('sites',(select count(*) from sites where tenant_id=$1),'racks',(select count(*) from racks where tenant_id=$1),'devices',(select count(*) from devices where tenant_id=$1),'active_devices',(select count(*) from devices where tenant_id=$1 and status='active'),'networks',(select count(*) from networks where tenant_id=$1),'vlans',(select count(*) from vlans where tenant_id=$1),'connections',(select count(*) from cables where tenant_id=$1))`, r.Context().Value(tenantKey).(string)).Scan(&v)
	if err != nil {
		fail(w, 500, "QUERY_FAILED", err.Error())
		return
	}
	respond(w, 200, map[string]any{"data": v})
}
func (s *Server) topology(w http.ResponseWriter, r *http.Request) {
	// host(...), not ::text: casting inet to text keeps its netmask (e.g.
	// "10.10.0.1/32"), which would leak into every management/device IP shown here.
	rows, err := s.q(r).Query(r.Context(), `select c.id,da.id,da.name,da.device_type,coalesce(host(da.management_ip),''),coalesce((select string_agg(host(i.address), ', ' order by i.address) from ip_addresses i where i.device_id=da.id and i.tenant_id=$1),''),da.status::text,pa.name,db.id,db.name,db.device_type,coalesce(host(db.management_ip),''),coalesce((select string_agg(host(i.address), ', ' order by i.address) from ip_addresses i where i.device_id=db.id and i.tenant_id=$1),''),db.status::text,pb.name,c.cable_type,coalesce(c.label,'') from cables c join device_ports pa on pa.id=c.port_a_id join devices da on da.id=pa.device_id join device_ports pb on pb.id=c.port_b_id join devices db on db.id=pb.device_id where c.tenant_id=$1 and pa.tenant_id=$1 and pb.tenant_id=$1 and da.tenant_id=$1 and db.tenant_id=$1`, r.Context().Value(tenantKey).(string))
	if err != nil {
		fail(w, 500, "QUERY_FAILED", err.Error())
		return
	}
	defer rows.Close()
	type edge struct {
		CableID    string `json:"cable_id"`
		AID        string `json:"device_a_id"`
		AName      string `json:"device_a_name"`
		AType      string `json:"device_a_type"`
		AIP        string `json:"device_a_ip"`
		AAddresses string `json:"device_a_addresses"`
		AStatus    string `json:"device_a_status"`
		APort      string `json:"port_a"`
		BID        string `json:"device_b_id"`
		BName      string `json:"device_b_name"`
		BType      string `json:"device_b_type"`
		BIP        string `json:"device_b_ip"`
		BAddresses string `json:"device_b_addresses"`
		BStatus    string `json:"device_b_status"`
		BPort      string `json:"port_b"`
		CableType  string `json:"cable_type"`
		Label      string `json:"label"`
	}
	data := []edge{}
	for rows.Next() {
		var e edge
		if err := rows.Scan(&e.CableID, &e.AID, &e.AName, &e.AType, &e.AIP, &e.AAddresses, &e.AStatus, &e.APort, &e.BID, &e.BName, &e.BType, &e.BIP, &e.BAddresses, &e.BStatus, &e.BPort, &e.CableType, &e.Label); err != nil {
			fail(w, 500, "TOPOLOGY_SCAN_FAILED", "Could not read topology data")
			return
		}
		data = append(data, e)
	}
	respond(w, 200, map[string]any{"data": data})
}
func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := "%" + r.URL.Query().Get("q") + "%"
	tenantID := r.Context().Value(tenantKey).(string)
	rows, err := s.q(r).Query(r.Context(), `select kind,id,label,detail from (select 'device' kind,id,name label,coalesce(host(management_ip),'') detail from devices where tenant_id=$2 union all select 'site',id,name,description from sites where tenant_id=$2 union all select 'rack',id,name,description from racks where tenant_id=$2 union all select 'ip',i.id,host(i.address),coalesce(d.name,'') from ip_addresses i left join devices d on d.id=i.device_id and d.tenant_id=$2 where i.tenant_id=$2) x where label ilike $1 or detail ilike $1 limit 25`, q, tenantID)
	if err != nil {
		fail(w, 500, "QUERY_FAILED", err.Error())
		return
	}
	defer rows.Close()
	data := []map[string]string{}
	for rows.Next() {
		var k, id, l, d string
		_ = rows.Scan(&k, &id, &l, &d)
		data = append(data, map[string]string{"kind": k, "id": id, "label": l, "detail": d})
	}
	respond(w, 200, map[string]any{"data": data})
}
func EnvSecure() bool { return os.Getenv("COOKIE_SECURE") == "true" }
