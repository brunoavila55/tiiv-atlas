package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Server struct {
	db     *pgxpool.Pool
	log    *slog.Logger
	secure bool
}

func BootstrapAdmin(ctx context.Context, db *pgxpool.Pool, name, email, password string) error {
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
	_, err = db.Exec(ctx, `insert into users(name,email,password_hash,role) values($1,$2,$3,'admin')`, name, strings.ToLower(strings.TrimSpace(email)), string(hash))
	return err
}

type ctxKey string

const userKey ctxKey = "user"

type user struct{ ID, Name, Email, Role string }

func New(db *pgxpool.Pool, log *slog.Logger, secure bool) http.Handler {
	s := &Server{db: db, log: log, secure: secure}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, s.securityHeaders, s.requestLog)
	r.Get("/health", s.health)
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)
		r.Group(func(r chi.Router) {
			r.Use(s.authenticate)
			r.Get("/auth/me", s.me)
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
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		fail(w, 500, "TX_FAILED", "Could not start installation")
		return
	}
	defer tx.Rollback(r.Context())
	var manufacturerID, modelID, deviceID string
	err = tx.QueryRow(r.Context(), `insert into manufacturers(name) values($1) on conflict(name) do update set name=excluded.name returning id`, strings.TrimSpace(in.Manufacturer)).Scan(&manufacturerID)
	if err == nil {
		err = tx.QueryRow(r.Context(), `insert into device_models(manufacturer_id,name,height_u) values($1,$2,$3) on conflict(manufacturer_id,name) do update set height_u=excluded.height_u returning id`, manufacturerID, strings.TrimSpace(in.Model), in.RackHeight).Scan(&modelID)
	}
	var rackID any
	var rackPosition any
	if in.RackID != "" {
		rackID, rackPosition = in.RackID, in.RackPosition
	}
	if err == nil {
		err = tx.QueryRow(r.Context(), `insert into devices(name,device_model_id,manufacturer_id,device_type,site_id,rack_id,rack_position,rack_height,management_ip,status,description,power_supply_count,power_input_voltage,power_capacity_watts) values($1,$2,$3,$4,$5,$6,$7,$8,nullif($9,'')::inet,$10,$11,$12,nullif($13,''),nullif($14,0)) returning id`, strings.TrimSpace(in.Name), modelID, manufacturerID, in.DeviceType, in.SiteID, rackID, rackPosition, in.RackHeight, in.ManagementIP, in.Status, in.Purpose, in.PowerSupplyCount, in.PowerInputVoltage, in.PowerCapacityWatts).Scan(&deviceID)
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
		err = tx.QueryRow(r.Context(), `insert into device_ports(device_id,name,type,speed) values($1,$2,$3,nullif($4,'')) returning id`, deviceID, strings.TrimSpace(port.Name), port.Type, port.Speed).Scan(&id)
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
		err = tx.QueryRow(r.Context(), `select p.id from device_ports p join devices d on d.id=p.device_id where d.site_id=$1 and lower(d.name)=lower($2) and lower(p.name)=lower($3)`, in.SiteID, connection.TargetDeviceName, connection.TargetPortName).Scan(&targetID)
		if err == nil {
			if connection.CableType == "" {
				connection.CableType = "cat6"
			}
			_, err = tx.Exec(r.Context(), `insert into cables(port_a_id,port_b_id,label,cable_type) values($1,$2,nullif($3,''),$4)`, localID, targetID, connection.Label, connection.CableType)
		}
	}
	if err == nil && strings.TrimSpace(in.ManagementIP) != "" {
		var ipID string
		var assignedDevice *string
		lookupErr := tx.QueryRow(r.Context(), `select id,device_id::text from ip_addresses where address=$1::inet`, in.ManagementIP).Scan(&ipID, &assignedDevice)
		switch {
		case lookupErr == nil && assignedDevice != nil && *assignedDevice != deviceID:
			err = fmt.Errorf("IP address is already assigned to another device")
		case lookupErr == nil:
			_, err = tx.Exec(r.Context(), `update ip_addresses set device_id=$1,status='active',updated_at=now() where id=$2`, deviceID, ipID)
		case errors.Is(lookupErr, pgx.ErrNoRows):
			var networkID string
			if err = tx.QueryRow(r.Context(), `select id from networks where prefix >>= $1::inet order by masklen(prefix) desc limit 1`, in.ManagementIP).Scan(&networkID); errors.Is(err, pgx.ErrNoRows) {
				err = fmt.Errorf("IP address does not belong to a documented network; create the network or continue without an IP")
			} else if err == nil {
				err = tx.QueryRow(r.Context(), `insert into ip_addresses(network_id,address,device_id,status,description) values($1,$2::inet,$3,'active','Management address') returning id`, networkID, in.ManagementIP, deviceID).Scan(&ipID)
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

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in) != nil {
		fail(w, 400, "INVALID_JSON", "Invalid request")
		return
	}
	var u user
	var hash string
	err := s.db.QueryRow(r.Context(), "select id,name,email,role,password_hash from users where lower(email)=lower($1)", in.Email).Scan(&u.ID, &u.Name, &u.Email, &u.Role, &hash)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		fail(w, 401, "INVALID_CREDENTIALS", "Invalid email or password")
		return
	}
	token := uuid.NewString()
	_, err = s.db.Exec(r.Context(), "insert into sessions(id,user_id,expires_at) values($1,$2,now()+interval '7 days')", token, u.ID)
	if err != nil {
		fail(w, 500, "SESSION_ERROR", "Could not create session")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "atlas_session", Value: token, Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: 604800})
	respond(w, 200, map[string]any{"data": u})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("atlas_session"); err == nil {
		_, _ = s.db.Exec(r.Context(), "delete from sessions where id=$1", c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "atlas_session", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode})
	respond(w, 200, map[string]any{"data": map[string]bool{"ok": true}})
}
func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("atlas_session")
		if err != nil {
			fail(w, 401, "UNAUTHENTICATED", "Authentication required")
			return
		}
		var u user
		err = s.db.QueryRow(r.Context(), `select u.id,u.name,u.email,u.role from sessions s join users u on u.id=s.user_id where s.id=$1 and s.expires_at>now()`, c.Value).Scan(&u.ID, &u.Name, &u.Email, &u.Role)
		if err != nil {
			fail(w, 401, "UNAUTHENTICATED", "Session expired")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	})
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, map[string]any{"data": r.Context().Value(userKey)})
}
func (s *Server) writeRequired(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := r.Context().Value(userKey).(user)
		if u.Role == "viewer" {
			fail(w, 403, "FORBIDDEN", "Read-only role")
			return
		}
		next(w, r)
	}
}

var tables = map[string]string{"sites": "sites", "rooms": "rooms", "racks": "racks", "manufacturers": "manufacturers", "device-models": "device_models", "devices": "devices", "ports": "device_ports", "connections": "cables", "networks": "networks", "ip-addresses": "ip_addresses", "vlans": "vlans"}

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
		q := fmt.Sprintf("select row_to_json(t) from (select * from %s order by created_at desc limit $1 offset $2) t", table)
		rows, err := s.db.Query(r.Context(), q, size, (page-1)*size)
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
		respond(w, 200, map[string]any{"data": data, "meta": map[string]int{"page": page, "page_size": size}})
	}
}
func (s *Server) get(resource string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := fmt.Sprintf("select row_to_json(t) from (select * from %s where id=$1) t", tables[resource])
		var v json.RawMessage
		if err := s.db.QueryRow(r.Context(), q, chi.URLParam(r, "id")).Scan(&v); errors.Is(err, pgx.ErrNoRows) {
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
		cols := []string{}
		vals := []any{}
		marks := []string{}
		i := 1
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
		if len(cols) == 0 {
			fail(w, 400, "EMPTY_REQUEST", "At least one field is required")
			return
		}
		q := fmt.Sprintf("insert into %s(%s) values(%s) returning id", tables[resource], strings.Join(cols, ","), strings.Join(marks, ","))
		var id string
		if err := s.db.QueryRow(r.Context(), q, vals...).Scan(&id); err != nil {
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
		sets := []string{}
		vals := []any{}
		i := 1
		for k, v := range in {
			if !safeColumn(k) {
				fail(w, 400, "INVALID_FIELD", "Invalid field name")
				return
			}
			sets = append(sets, fmt.Sprintf("%s=$%d", k, i))
			vals = append(vals, v)
			i++
		}
		if len(sets) == 0 {
			fail(w, 400, "EMPTY_REQUEST", "At least one field is required")
			return
		}
		vals = append(vals, chi.URLParam(r, "id"))
		q := fmt.Sprintf("update %s set %s,updated_at=now() where id=$%d", tables[resource], strings.Join(sets, ","), i)
		tag, err := s.db.Exec(r.Context(), q, vals...)
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
		tag, err := s.db.Exec(r.Context(), fmt.Sprintf("delete from %s where id=$1", tables[resource]), chi.URLParam(r, "id"))
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
	rows, err := s.db.Query(r.Context(), "select row_to_json(p) from device_ports p where device_id=$1 order by name", chi.URLParam(r, "id"))
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
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		fail(w, 500, "TX_FAILED", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	for i := in.Start; i <= in.End; i++ {
		_, err = tx.Exec(r.Context(), "insert into device_ports(device_id,name,type) values($1,$2,$3)", chi.URLParam(r, "id"), fmt.Sprintf("%s%d", in.Prefix, i), in.Type)
		if err != nil {
			fail(w, 422, "PORT_CREATE_FAILED", err.Error())
			return
		}
	}
	_ = tx.Commit(r.Context())
	respond(w, 201, map[string]any{"data": map[string]int{"created": in.End - in.Start + 1}})
}
func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	var v json.RawMessage
	err := s.db.QueryRow(r.Context(), `select json_build_object('sites',(select count(*) from sites),'racks',(select count(*) from racks),'devices',(select count(*) from devices),'active_devices',(select count(*) from devices where status='active'),'networks',(select count(*) from networks),'vlans',(select count(*) from vlans),'connections',(select count(*) from cables))`).Scan(&v)
	if err != nil {
		fail(w, 500, "QUERY_FAILED", err.Error())
		return
	}
	respond(w, 200, map[string]any{"data": v})
}
func (s *Server) topology(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `select c.id,da.id,da.name,da.device_type,coalesce(da.management_ip::text,''),coalesce((select string_agg(i.address::text, ', ' order by i.address) from ip_addresses i where i.device_id=da.id),''),da.status::text,pa.name,db.id,db.name,db.device_type,coalesce(db.management_ip::text,''),coalesce((select string_agg(i.address::text, ', ' order by i.address) from ip_addresses i where i.device_id=db.id),''),db.status::text,pb.name,c.cable_type,coalesce(c.label,'') from cables c join device_ports pa on pa.id=c.port_a_id join devices da on da.id=pa.device_id join device_ports pb on pb.id=c.port_b_id join devices db on db.id=pb.device_id`)
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
	rows, err := s.db.Query(r.Context(), `select kind,id,label,detail from (select 'device' kind,id,name label,coalesce(management_ip::text,'') detail from devices union all select 'site',id,name,description from sites union all select 'rack',id,name,description from racks union all select 'ip',i.id,i.address::text,coalesce(d.name,'') from ip_addresses i left join devices d on d.id=i.device_id) x where label ilike $1 or detail ilike $1 limit 25`, q)
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
