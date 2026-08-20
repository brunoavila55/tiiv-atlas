package server

import "testing"

func TestMatchPortalHost(t *testing.T) {
	tests := []struct {
		name       string
		host       string
		baseDomain string
		kind       string
		slug       string
		ok         bool
	}{
		{name: "global portal", host: "atlas.tiiv.com.br", baseDomain: "atlas.tiiv.com.br", kind: "global", ok: true},
		{name: "tenant portal", host: "newlife.atlas.tiiv.com.br", baseDomain: "atlas.tiiv.com.br", kind: "tenant", slug: "newlife", ok: true},
		{name: "tenant portal with port", host: "newlife.atlas.tiiv.com.br:15467", baseDomain: "atlas.tiiv.com.br", kind: "tenant", slug: "newlife", ok: true},
		{name: "case and trailing dot", host: "NewLife.Atlas.Tiiv.Com.Br.", baseDomain: "ATLAS.TIIV.COM.BR", kind: "tenant", slug: "newlife", ok: true},
		{name: "unscoped development", host: "localhost:3000", baseDomain: "", kind: "unscoped", ok: true},
		{name: "unknown domain", host: "example.com", baseDomain: "atlas.tiiv.com.br", ok: false},
		{name: "nested subdomain", host: "other.newlife.atlas.tiiv.com.br", baseDomain: "atlas.tiiv.com.br", ok: false},
		{name: "lookalike domain", host: "newlife.atlas.tiiv.com.br.example.com", baseDomain: "atlas.tiiv.com.br", ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			kind, slug, ok := matchPortalHost(tt.host, tt.baseDomain)
			if kind != tt.kind || slug != tt.slug || ok != tt.ok {
				t.Fatalf("matchPortalHost() = (%q, %q, %v), want (%q, %q, %v)", kind, slug, ok, tt.kind, tt.slug, tt.ok)
			}
		})
	}
}

func TestCanonicalHostnameIPv6(t *testing.T) {
	if got := canonicalHostname("[::1]:8080"); got != "::1" {
		t.Fatalf("canonicalHostname() = %q, want ::1", got)
	}
}

func TestPortalURLPreservesPublicPort(t *testing.T) {
	s := &Server{baseDomain: "atlas.newlifefibra.com.br"}
	if got, want := s.portalURL("fibra", "atlas.newlifefibra.com.br:15467"), "http://fibra.atlas.newlifefibra.com.br:15467"; got != want {
		t.Fatalf("portalURL() = %q, want %q", got, want)
	}
	if got, want := s.portalURL("fibra", "atlas.newlifefibra.com.br"), "http://fibra.atlas.newlifefibra.com.br"; got != want {
		t.Fatalf("portalURL() = %q, want %q", got, want)
	}
}
