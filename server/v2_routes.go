package main

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

func requestBaseURL(r *http.Request) string {
	scheme := "http"
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); forwarded != "" {
		scheme = forwarded
	} else if r.TLS != nil {
		scheme = "https"
	}
	host := strings.TrimSpace(r.Host)
	if host == "" {
		return ""
	}
	return scheme + "://" + host
}

func (a *app) cleanupV2Expired() {
	a.v2.mu.Lock()
	defer a.v2.mu.Unlock()
	a.v2.pruneExpiredLocked(nowMillis())
}

func (a *app) authenticateV2Request(r *http.Request) (v2Principal, error) {
	return a.v2.authenticate(readBearerToken(r))
}

func (a *app) emitV2Signal(targetType string, targetID string, event SignalEvent) bool {
	if a.persistence.UseExternalSignalQueue() {
		deliveredLocal := a.v2.deliverSignalEvent(targetType, targetID, event)
		a.persistence.PushSignal(targetType, targetID, event, deliveredLocal)
		return deliveredLocal
	}
	return a.v2.enqueueSignalEvent(targetType, targetID, event)
}

func (a *app) pullV2SignalInbox(clientType string, clientID string, limit int) []SignalEvent {
	if a.persistence.UseExternalSignalQueue() {
		events, err := a.persistence.PullSignalInbox(clientType, clientID, limit)
		if err == nil {
			return events
		}
	}
	return a.v2.pullSignalInbox(clientType, clientID, limit)
}

func (a *app) serveV2(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.Path
	method := r.Method
	if !strings.HasPrefix(path, "/v2/") {
		return false
	}

	if method == http.MethodPost && path == "/v2/auth/challenge" {
		var req v2ChallengeRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		challenge, err := a.v2.createChallenge(req)
		if err != nil {
			writeError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "challenge": challenge})
		return true
	}

	if method == http.MethodPost && path == "/v2/auth/login" {
		var req v2LoginRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		session, err := a.v2.login(req)
		if err != nil {
			writeError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session})
		return true
	}

	if method == http.MethodGet && path == "/v2/ice-servers" {
		if _, err := a.authenticateV2Request(r); err != nil {
			writeError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"iceServers": a.v2ICEConfig.ICEServers,
			"ttlSeconds": a.v2ICEConfig.TTLSeconds,
		})
		return true
	}

	if method == http.MethodPost && path == "/v2/presence/announce" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		var req v2PresenceAnnounceRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		desktop, err := a.v2.announceDesktop(principal, req)
		if err != nil {
			writeError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "desktop": desktop})
		return true
	}

	if method == http.MethodPost && path == "/v2/presence/heartbeat" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		var req v2PresenceHeartbeatRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		desktop, err := a.v2.heartbeatDesktop(principal, req)
		if err != nil {
			writeError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "desktop": desktop})
		return true
	}

	if method == http.MethodPost && path == "/v2/presence/query" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		var req v2PresenceQueryRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		statuses, err := a.v2.queryPresence(principal, req)
		if err != nil {
			writeError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "statuses": statuses})
		return true
	}

	if method == http.MethodPost && path == "/v2/pair/sessions" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		var req v2CreatePairSessionRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		session, err := a.v2.createPairSession(principal, req)
		if err != nil {
			writeError(w, err)
			return true
		}
		qrPayload := map[string]any{
			"version":       "openclaw-pair-v2",
			"serverBaseUrl": requestBaseURL(r),
			"pairSessionId": session.PairSessionID,
			"claimToken":    session.ClaimToken,
			"deviceId":      session.DeviceID,
			"devicePubkey":  session.DevicePublicKey,
			"sessionNonce":  session.SessionNonce,
			"expiresAt":     session.ExpiresAt,
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "session": session, "qrPayload": qrPayload})
		return true
	}

	if method == http.MethodPost && path == "/v2/pair/claims" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		var req v2PairClaimRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		session, binding, err := a.v2.claimPair(principal, req)
		if err != nil {
			writeError(w, err)
			return true
		}
		event := SignalEvent{
			ID:   fmt.Sprintf("v2_pair_claim_%d", nowMillis()),
			Type: "pair.claimed",
			Ts:   nowMillis(),
			Payload: map[string]any{
				"pairSessionId":   session.PairSessionID,
				"bindingId":       binding.BindingID,
				"deviceId":        binding.DeviceID,
				"devicePublicKey": binding.DevicePublicKey,
				"mobileId":        binding.MobileID,
				"mobilePublicKey": binding.MobilePublicKey,
				"trustState":      binding.TrustState,
				"sessionNonce":    session.SessionNonce,
			},
		}
		a.emitV2Signal(string(v2EntityDesktop), binding.DeviceID, event)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pairSession": session, "binding": binding})
		return true
	}

	if method == http.MethodPost && path == "/v2/pair/approvals" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		var req v2PairApproveRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		binding, err := a.v2.approveBinding(principal, req)
		if err != nil {
			writeError(w, err)
			return true
		}
		event := SignalEvent{
			ID:   fmt.Sprintf("v2_pair_approved_%d", nowMillis()),
			Type: "pair.approved",
			Ts:   nowMillis(),
			Payload: map[string]any{
				"bindingId":  binding.BindingID,
				"deviceId":   binding.DeviceID,
				"mobileId":   binding.MobileID,
				"trustState": binding.TrustState,
				"approvedAt": binding.ApprovedAt,
			},
		}
		a.emitV2Signal(string(v2EntityMobile), binding.MobileID, event)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "binding": binding})
		return true
	}

	if method == http.MethodPost && path == "/v2/pair/revoke" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		var req v2PairRevokeRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		binding, err := a.v2.revokeBinding(principal, req)
		if err != nil {
			writeError(w, err)
			return true
		}
		event := SignalEvent{
			ID:   fmt.Sprintf("v2_pair_revoked_%d", nowMillis()),
			Type: "pair.revoked",
			Ts:   nowMillis(),
			Payload: map[string]any{
				"bindingId":  binding.BindingID,
				"deviceId":   binding.DeviceID,
				"mobileId":   binding.MobileID,
				"trustState": binding.TrustState,
				"revokedAt":  binding.RevokedAt,
			},
		}
		a.emitV2Signal(string(v2EntityDesktop), binding.DeviceID, event)
		a.emitV2Signal(string(v2EntityMobile), binding.MobileID, event)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "binding": binding})
		return true
	}

	if method == http.MethodGet && path == "/v2/bindings" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		includeRevoked := strings.TrimSpace(r.URL.Query().Get("includeRevoked")) == "true"
		bindings := a.v2.listBindings(principal, includeRevoked)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bindings": bindings})
		return true
	}

	if method == http.MethodPost && path == "/v2/signal/send" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		var req sendSignalRequest
		if err := readJSONBody(r, &req); err != nil {
			writeError(w, err)
			return true
		}
		if err := a.v2.authorizeSignalSend(principal, req); err != nil {
			writeError(w, err)
			return true
		}
		event, err := a.v2.buildSignalEvent(req)
		if err != nil {
			writeError(w, err)
			return true
		}
		deliveredRealtime := a.emitV2Signal(event.To.Type, event.To.ID, event)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deliveredRealtime": deliveredRealtime, "event": event})
		return true
	}

	if method == http.MethodGet && path == "/v2/signal/stream" {
		principal, err := a.authenticateV2Request(r)
		if err != nil {
			writeError(w, err)
			return true
		}
		clientType, err := trimRequired(r.URL.Query().Get("clientType"), "clientType")
		if err != nil {
			writeError(w, err)
			return true
		}
		clientID, err := trimRequired(r.URL.Query().Get("clientId"), "clientId")
		if err != nil {
			writeError(w, err)
			return true
		}
		if err := a.v2.authorizeSignalClient(principal, clientType, clientID); err != nil {
			writeError(w, err)
			return true
		}

		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)

		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, newError("INTERNAL_ERROR", "streaming is not supported"))
			return true
		}

		sub := a.v2.addSubscriber(clientType, clientID)
		defer a.v2.removeSubscriber(clientType, clientID, sub)

		var externalSub <-chan SignalEvent
		var closeExternalSub func()
		if a.persistence.UseExternalSignalQueue() {
			subChannel, closeFn, subscribeErr := a.persistence.SubscribeSignals(clientType, clientID)
			if subscribeErr == nil {
				externalSub = subChannel
				closeExternalSub = closeFn
				defer closeExternalSub()
			}
		}

		openedID, _ := makeID("v2stream")
		opened := SignalEvent{
			ID:   openedID,
			Type: "stream.opened",
			Ts:   nowMillis(),
			Payload: map[string]any{
				"clientType": clientType,
				"clientId":   clientID,
			},
		}
		if err := writeSSE(w, opened); err != nil {
			return true
		}
		flusher.Flush()

		queued := a.pullV2SignalInbox(clientType, clientID, maxSignalQueuePull)
		if len(queued) > 0 {
			for _, event := range queued {
				if err := writeSSE(w, event); err != nil {
					return true
				}
			}
			flusher.Flush()
		}

		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case event := <-sub:
				if err := writeSSE(w, event); err != nil {
					return true
				}
				flusher.Flush()
			case event, ok := <-externalSub:
				if !ok {
					externalSub = nil
					continue
				}
				if err := writeSSE(w, event); err != nil {
					return true
				}
				flusher.Flush()
			case <-ticker.C:
				if _, err := fmt.Fprintf(w, "event: ping\ndata: {\"ts\":%d}\n\n", nowMillis()); err != nil {
					return true
				}
				flusher.Flush()
			case <-r.Context().Done():
				return true
			}
		}
	}

	if method == http.MethodGet && path == "/v2/signal/ws" {
		writeJSON(w, http.StatusNotImplemented, map[string]any{
			"ok":      false,
			"code":    "WS_NOT_ENABLED",
			"message": "WebSocket endpoint is not enabled yet. Use /v2/signal/stream and /v2/signal/send during the first v2 stage.",
		})
		return true
	}

	writeJSON(w, http.StatusNotFound, map[string]any{
		"ok":      false,
		"code":    "NOT_FOUND",
		"message": "Route not found",
	})
	return true
}
