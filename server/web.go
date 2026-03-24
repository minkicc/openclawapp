package main

import (
	"bytes"
	"embed"
	"io/fs"
	"net/http"
	"time"
)

//go:embed web/index.html web/styles.css
var protocolSiteFS embed.FS

func serveProtocolSite(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}

	switch r.URL.Path {
	case "/", "/protocol":
		return serveProtocolAsset(w, r, "web/index.html", "text/html; charset=utf-8")
	case "/assets/protocol.css":
		return serveProtocolAsset(w, r, "web/styles.css", "text/css; charset=utf-8")
	default:
		return false
	}
}

func serveProtocolAsset(w http.ResponseWriter, r *http.Request, name string, contentType string) bool {
	content, err := fs.ReadFile(protocolSiteFS, name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":      false,
			"code":    "INTERNAL_ERROR",
			"message": "protocol asset is unavailable",
		})
		return true
	}

	w.Header().Set("Content-Type", contentType)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(content))
	return true
}
