package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProtocolLandingPage(t *testing.T) {
	app := newTestApp()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	app.serveHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status: got=%d body=%s", rec.Code, rec.Body.String())
	}
	if contentType := rec.Header().Get("Content-Type"); !strings.Contains(contentType, "text/html") {
		t.Fatalf("unexpected content type: %s", contentType)
	}
	if !strings.Contains(rec.Body.String(), "OpenClaw Pair Protocol") {
		t.Fatalf("landing page body missing protocol title: %s", rec.Body.String())
	}
}

func TestProtocolLandingStyles(t *testing.T) {
	app := newTestApp()

	req := httptest.NewRequest(http.MethodGet, "/assets/protocol.css", nil)
	rec := httptest.NewRecorder()
	app.serveHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status: got=%d body=%s", rec.Code, rec.Body.String())
	}
	if contentType := rec.Header().Get("Content-Type"); !strings.Contains(contentType, "text/css") {
		t.Fatalf("unexpected content type: %s", contentType)
	}
	if !strings.Contains(rec.Body.String(), ".hero") {
		t.Fatalf("stylesheet body missing expected selector: %s", rec.Body.String())
	}
}
