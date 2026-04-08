package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestApp() *app {
	store := newStore()
	return &app{
		store:       store,
		v2:          newV2Store(),
		v2ICEConfig: defaultV2ICEConfig(),
		persistence: &memoryPersistence{},
	}
}

func doJSONRequest(t *testing.T, app *app, method string, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()

	var payload []byte
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		payload = encoded
	}

	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	app.serveHTTP(rec, req)
	return rec
}

func decodeResponseBody(t *testing.T, rec *httptest.ResponseRecorder, dst any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), dst); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, rec.Body.String())
	}
}

func mustGenerateKeyPair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey, string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}
	return pub, priv, base64.RawURLEncoding.EncodeToString(pub)
}

func mustLoginV2(t *testing.T, app *app, entityType string, entityID string, publicKey string, privateKey ed25519.PrivateKey) v2AuthSession {
	t.Helper()

	challengeRec := doJSONRequest(t, app, http.MethodPost, "/v2/auth/challenge", map[string]any{
		"entityType": entityType,
		"entityId":   entityID,
		"publicKey":  publicKey,
	}, "")
	if challengeRec.Code != http.StatusOK {
		t.Fatalf("challenge failed: status=%d body=%s", challengeRec.Code, challengeRec.Body.String())
	}
	var challengeResp struct {
		Challenge v2AuthChallenge `json:"challenge"`
	}
	decodeResponseBody(t, challengeRec, &challengeResp)

	signature := ed25519.Sign(privateKey, buildV2LoginMessage(challengeResp.Challenge))
	loginRec := doJSONRequest(t, app, http.MethodPost, "/v2/auth/login", map[string]any{
		"entityType":  entityType,
		"entityId":    entityID,
		"publicKey":   publicKey,
		"challengeId": challengeResp.Challenge.ChallengeID,
		"signature":   base64.RawURLEncoding.EncodeToString(signature),
	}, "")
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login failed: status=%d body=%s", loginRec.Code, loginRec.Body.String())
	}
	var loginResp struct {
		Session v2AuthSession `json:"session"`
	}
	decodeResponseBody(t, loginRec, &loginResp)
	return loginResp.Session
}

func TestV2AuthPresencePairingFlow(t *testing.T) {
	app := newTestApp()

	_, desktopPriv, desktopPubText := mustGenerateKeyPair(t)
	_, mobilePriv, mobilePubText := mustGenerateKeyPair(t)

	desktopSession := mustLoginV2(t, app, "desktop", "desk_test", desktopPubText, desktopPriv)
	mobileSession := mustLoginV2(t, app, "mobile", "mob_test", mobilePubText, mobilePriv)

	announceRec := doJSONRequest(t, app, http.MethodPost, "/v2/presence/announce", map[string]any{
		"platform":   "macos",
		"appVersion": "0.2.0",
		"capabilities": map[string]any{
			"webrtc": true,
		},
	}, desktopSession.Token)
	if announceRec.Code != http.StatusOK {
		t.Fatalf("announce failed: status=%d body=%s", announceRec.Code, announceRec.Body.String())
	}

	pairSessionRec := doJSONRequest(t, app, http.MethodPost, "/v2/pair/sessions", map[string]any{
		"ttlSeconds": 180,
	}, desktopSession.Token)
	if pairSessionRec.Code != http.StatusOK {
		t.Fatalf("create pair session failed: status=%d body=%s", pairSessionRec.Code, pairSessionRec.Body.String())
	}
	var pairSessionResp struct {
		Session v2PairSession `json:"session"`
	}
	decodeResponseBody(t, pairSessionRec, &pairSessionResp)

	claimRec := doJSONRequest(t, app, http.MethodPost, "/v2/pair/claims", map[string]any{
		"claimToken": pairSessionResp.Session.ClaimToken,
		"mobileName": "测试手机",
	}, mobileSession.Token)
	if claimRec.Code != http.StatusOK {
		t.Fatalf("claim failed: status=%d body=%s", claimRec.Code, claimRec.Body.String())
	}
	var claimResp struct {
		Binding v2Binding `json:"binding"`
	}
	decodeResponseBody(t, claimRec, &claimResp)
	if claimResp.Binding.TrustState != v2TrustStatePending {
		t.Fatalf("expected pending binding, got %s", claimResp.Binding.TrustState)
	}
	if claimResp.Binding.MobileName != "测试手机" {
		t.Fatalf("expected mobile name to round-trip, got %q", claimResp.Binding.MobileName)
	}

	approveRec := doJSONRequest(t, app, http.MethodPost, "/v2/pair/approvals", map[string]any{
		"bindingId": claimResp.Binding.BindingID,
	}, desktopSession.Token)
	if approveRec.Code != http.StatusOK {
		t.Fatalf("approve failed: status=%d body=%s", approveRec.Code, approveRec.Body.String())
	}
	var approveResp struct {
		Binding v2Binding `json:"binding"`
	}
	decodeResponseBody(t, approveRec, &approveResp)
	if approveResp.Binding.TrustState != v2TrustStateActive {
		t.Fatalf("expected active binding, got %s", approveResp.Binding.TrustState)
	}

	presenceRec := doJSONRequest(t, app, http.MethodPost, "/v2/presence/query", map[string]any{
		"deviceIds": []string{"desk_test"},
	}, mobileSession.Token)
	if presenceRec.Code != http.StatusOK {
		t.Fatalf("presence query failed: status=%d body=%s", presenceRec.Code, presenceRec.Body.String())
	}
	var presenceResp struct {
		Statuses []v2PresenceStatus `json:"statuses"`
	}
	decodeResponseBody(t, presenceRec, &presenceResp)
	if len(presenceResp.Statuses) != 1 || presenceResp.Statuses[0].Status != "online" {
		t.Fatalf("expected one online desktop, got %+v", presenceResp.Statuses)
	}

	sendRec := doJSONRequest(t, app, http.MethodPost, "/v2/signal/send", map[string]any{
		"fromType": "mobile",
		"fromId":   "mob_test",
		"toType":   "desktop",
		"toId":     "desk_test",
		"type":     "relay.message",
		"payload": map[string]any{
			"text": "hello",
		},
	}, mobileSession.Token)
	if sendRec.Code != http.StatusOK {
		t.Fatalf("signal send failed: status=%d body=%s", sendRec.Code, sendRec.Body.String())
	}

	events := app.v2.pullSignalInbox("desktop", "desk_test", 10)
	if len(events) == 0 {
		t.Fatalf("expected queued signal event")
	}
	if events[len(events)-1].Type != "relay.message" {
		t.Fatalf("expected relay.message event, got %s", events[len(events)-1].Type)
	}
}

func TestV2RejectsInvalidLoginSignature(t *testing.T) {
	app := newTestApp()

	_, desktopPriv, desktopPubText := mustGenerateKeyPair(t)
	_, otherPriv, _ := mustGenerateKeyPair(t)

	challengeRec := doJSONRequest(t, app, http.MethodPost, "/v2/auth/challenge", map[string]any{
		"entityType": "desktop",
		"entityId":   "desk_invalid",
		"publicKey":  desktopPubText,
	}, "")
	if challengeRec.Code != http.StatusOK {
		t.Fatalf("challenge failed: status=%d body=%s", challengeRec.Code, challengeRec.Body.String())
	}
	var challengeResp struct {
		Challenge v2AuthChallenge `json:"challenge"`
	}
	decodeResponseBody(t, challengeRec, &challengeResp)

	signature := ed25519.Sign(otherPriv, buildV2LoginMessage(challengeResp.Challenge))
	loginRec := doJSONRequest(t, app, http.MethodPost, "/v2/auth/login", map[string]any{
		"entityType":  "desktop",
		"entityId":    "desk_invalid",
		"publicKey":   desktopPubText,
		"challengeId": challengeResp.Challenge.ChallengeID,
		"signature":   base64.RawURLEncoding.EncodeToString(signature),
	}, "")
	if loginRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid signature, got %d body=%s", loginRec.Code, loginRec.Body.String())
	}

	validSession := mustLoginV2(t, app, "desktop", "desk_invalid", desktopPubText, desktopPriv)
	if validSession.EntityID != "desk_invalid" {
		t.Fatalf("expected desk_invalid session, got %+v", validSession)
	}
}

func TestV2ICEServersEndpoint(t *testing.T) {
	app := newTestApp()
	app.v2ICEConfig = v2ICEConfig{
		ICEServers: []v2ICEServer{
			{
				URLs:       []string{"stun:stun.example.com:3478"},
				Username:   "turn-user",
				Credential: "turn-pass",
			},
		},
		TTLSeconds: 900,
	}

	_, desktopPriv, desktopPubText := mustGenerateKeyPair(t)
	desktopSession := mustLoginV2(t, app, "desktop", "desk_ice", desktopPubText, desktopPriv)

	rec := doJSONRequest(t, app, http.MethodGet, "/v2/ice-servers", nil, desktopSession.Token)
	if rec.Code != http.StatusOK {
		t.Fatalf("ice servers failed: status=%d body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		ICEServers []v2ICEServer `json:"iceServers"`
		TTLSeconds int           `json:"ttlSeconds"`
	}
	decodeResponseBody(t, rec, &resp)

	if resp.TTLSeconds != 900 {
		t.Fatalf("expected ttl 900, got %d", resp.TTLSeconds)
	}
	if len(resp.ICEServers) != 1 {
		t.Fatalf("expected 1 ice server, got %d", len(resp.ICEServers))
	}
	if len(resp.ICEServers[0].URLs) != 1 || resp.ICEServers[0].URLs[0] != "stun:stun.example.com:3478" {
		t.Fatalf("unexpected ice server urls: %+v", resp.ICEServers)
	}
}
